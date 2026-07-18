#!/usr/bin/env bash
set -euo pipefail

version="${ACTIONLINT_VERSION:-1.7.12}"
binary="$(
	scripts/ci/install-release-tool.sh \
		actionlint "$version" rhysd/actionlint actionlint actionlint
)"
"$binary" -version
"$binary" "$@"
