#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEVCONTAINER_USER="${DEVCONTAINER_USER:-vscode}"
DEVCONTAINER_SHELL="${DEVCONTAINER_SHELL:-/bin/bash}"
DEVCONTAINER_WORKSPACE_FOLDER="${DEVCONTAINER_WORKSPACE_FOLDER:-${REPO_ROOT}}"
DEVCONTAINER_WORKDIR="${DEVCONTAINER_WORKDIR:-/workspaces/$(basename "${REPO_ROOT}")}"
DEVCONTAINER_DEFAULT_SERVICE="${DEVCONTAINER_DEFAULT_SERVICE:-main}"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

require_docker() {
    command -v docker >/dev/null 2>&1 || die "docker command not found"
}

single_container_id() {
    local ids=("$@")

    case "${#ids[@]}" in
    0)
        return 1
        ;;
    1)
        printf '%s\n' "${ids[0]}"
        ;;
    *)
        echo "ERROR: multiple devcontainer candidates found: ${ids[*]}. Set DEVCONTAINER_CONTAINER to choose one." >&2
        return 2
        ;;
    esac
}

find_devcontainer_by_label() {
    local ids=()
    local config_file="${REPO_ROOT}/.devcontainer/devcontainer.json"

    mapfile -t ids < <(docker ps -q --filter "label=devcontainer.local_folder=${DEVCONTAINER_WORKSPACE_FOLDER}")
    if [ "${#ids[@]}" -gt 0 ]; then
        single_container_id "${ids[@]}"
        return
    fi

    mapfile -t ids < <(docker ps -q --filter "label=devcontainer.config_file=${config_file}")
    if [ "${#ids[@]}" -gt 0 ]; then
        single_container_id "${ids[@]}"
        return
    fi

    return 1
}

login_with_docker_exec() {
    local container_id="${1}"
    shift

    exec docker exec -u "${DEVCONTAINER_USER}" -it -w "${DEVCONTAINER_WORKDIR}" "${container_id}" "${DEVCONTAINER_SHELL}" "$@"
}

login_with_docker_compose() {
    local service="${1}"
    shift

    exec docker compose exec -u "${DEVCONTAINER_USER}" -it -w "${DEVCONTAINER_WORKDIR}" "${service}" "${DEVCONTAINER_SHELL}" "$@"
}

login_with_default_docker_compose() {
    if docker compose config --services 2>/dev/null | grep -Fxq "${DEVCONTAINER_DEFAULT_SERVICE}"; then
        login_with_docker_compose "${DEVCONTAINER_DEFAULT_SERVICE}" "$@"
    fi

    return 1
}

cd "${REPO_ROOT}"

require_docker

if [ -n "${DEVCONTAINER_CONTAINER:-}" ]; then
    login_with_docker_exec "${DEVCONTAINER_CONTAINER}" "$@"
fi

container_id=""
find_status=0
container_id="$(find_devcontainer_by_label)" || find_status=$?
if [ "${find_status}" -eq 0 ]; then
    login_with_docker_exec "${container_id}" "$@"
fi
if [ "${find_status}" -eq 2 ]; then
    exit 1
fi

compose_service="${DEVCONTAINER_SERVICE:-${DEVCONTAINER_COMPOSE_SERVICE:-}}"
if [ -n "${compose_service}" ]; then
    login_with_docker_compose "${compose_service}" "$@"
fi

if login_with_default_docker_compose "$@"; then
    exit 0
fi

die "devcontainer container not found. Reopen the repository in a Dev Container, or set DEVCONTAINER_CONTAINER/DEVCONTAINER_WORKSPACE_FOLDER."
