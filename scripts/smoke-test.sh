#!/bin/sh
set -eu

binary=./dist/markport
if [ "${RUNNER_OS:-}" = Windows ]; then
  binary=./dist/markport.exe
fi
expected_version=${1:-ci}

"$binary" --help
test "$("$binary" --version)" = "$expected_version"

port=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
"$binary" testdata --port "$port" > server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' 0
trap 'exit 1' 1 2 3 15

ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  attempt=$((attempt + 1))
  if curl --fail --silent --output tree.json "http://127.0.0.1:$port/api/tree"; then
    ready=true
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$ready" != true ] || ! kill -0 "$server_pid" 2>/dev/null || ! test -s tree.json; then
  echo "Markport smoke check failed on port $port." >&2
  cat server.log >&2
  exit 1
fi

echo "Markport smoke check passed on port $port."
