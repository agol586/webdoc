#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-dev}"
config_path="${DOCSHARE_CONFIG:-$repo_root/docshare.config.yaml}"
example_config="$repo_root/docshare.config.example.yaml"

if [[ ! -f "$config_path" ]]; then
  if [[ -f "$example_config" ]]; then
    cp "$example_config" "$config_path"
    echo "Created $config_path from docshare.config.example.yaml"
  else
    echo "Missing config file: $config_path" >&2
    exit 1
  fi
fi

cd "$repo_root"

case "$mode" in
  dev)
    exec npm run dev
    ;;
  start)
    exec npm run start
    ;;
  *)
    echo "Usage: $0 [dev|start]" >&2
    exit 1
    ;;
esac