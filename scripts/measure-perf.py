#!/usr/bin/env python3
"""Measure a built Markport binary; keep raw execve traces and curl results.

Usage: python3 scripts/measure-perf.py /absolute/path/to/markport output-prefix
Requires curl, Git, and strace (Linux). Fixture setup is outside measured requests.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def measure(binary, prefix):
    prefix = Path(prefix).resolve()
    prefix.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="markport-perf-") as directory:
        root = Path(directory)

        def git(*args):
            subprocess.run(["git", "-C", directory, *args], check=True,
                           stdout=subprocess.DEVNULL)

        git("init", "-q")
        git("config", "user.name", "Perf")
        git("config", "user.email", "perf@example.com")
        git("config", "commit.gpgsign", "false")
        git("config", "gc.auto", "0")
        for i in range(50):
            (root / f"file-{i:03}.txt").write_text("old\n")
        git("add", ".")
        git("commit", "-qm", "initial")
        for i in range(50):
            (root / f"file-{i:03}.txt").write_text("new\n")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        address = f"http://127.0.0.1:{port}"
        trace = Path(str(prefix) + "-execve.txt")
        with open(str(prefix) + "-server.log", "w") as log:
            process = subprocess.Popen(
                ["strace", "-f", "-e", "trace=execve", "-o", str(trace),
                 str(Path(binary).resolve()), directory, "--port", str(port)],
                stdout=log, stderr=log, start_new_session=True,
                env={**os.environ, "XDG_CACHE_HOME": str(root / ".git" / "perf-cache")})
            try:
                def get(path):
                    with urllib.request.urlopen(address + path, timeout=30) as response:
                        return response.read()

                for _ in range(100):
                    try:
                        get("/api/instance")
                        break
                    except OSError:
                        if process.poll() is not None:
                            raise RuntimeError("server exited before startup")
                        time.sleep(0.05)
                else:
                    raise RuntimeError("server startup timed out")
                # Ignore startup and populate line-count/content caches.
                get("/api/git/changes")
                offset = len(trace.read_text().splitlines())
                start = time.perf_counter()
                get("/api/git/changes")
                elapsed = time.perf_counter() - start
                calls = [line for line in trace.read_text().splitlines()[offset:]
                         if "execve(" in line and "= 0" in line
                         and '"--no-pager"' in line]
                results = {"git_processes": len(calls),
                           "traced_poll_wall_ms": elapsed * 1000, "execve": calls}
                # Add rendering inputs only after measuring the Git poll.
                fixtures = Path(__file__).resolve().parent.parent / "testdata"
                for name in ["README.md", "sample.py"]:
                    (root / name).write_bytes((fixtures / name).read_bytes())
                paragraph = "A paragraph with **emphasis** and [a link](other.md). " * 96
                (root / "large.md").write_text(
                    (paragraph + "\n\n```go\npackage main\nfunc main() {}\n```\n\n") * 200)
                results["file_responses"] = {}
                for name in ["README.md", "sample.py", "large.md"]:
                    curl = subprocess.check_output(
                        ["curl", "--fail", "--silent", "-o", os.devnull,
                         "-w", "%{time_total} %{size_download}",
                         address + "/api/file?path=" + name], text=True)
                    seconds, size = curl.split()
                    results["file_responses"][name] = {
                        "seconds": float(seconds), "bytes": int(size)}
                Path(str(prefix) + ".json").write_text(json.dumps(results, indent=2) + "\n")
                print(json.dumps({key: value for key, value in results.items()
                                  if key != "execve"}, indent=2))
            finally:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait()


if __name__ == "__main__":
    measure(*sys.argv[1:])
