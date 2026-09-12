#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

mode=full
case "${1:-}" in
  "") ;;
  --source) mode=source; shift ;;
  *) echo "Usage: pnpm verify [--source]" >&2; exit 2 ;;
esac
if [[ $# -ne 0 ]]; then
  echo "Usage: pnpm verify [--source]" >&2
  exit 2
fi
exec node --experimental-strip-types scripts/ci/evidence.mts --verify "$mode"
