#!/usr/bin/env bash
set -euo pipefail

base="${1:?base revision is required}"
head="${2:?pull request head revision is required}"
version="${GITLEAKS_VERSION:-8.30.1}"
binary="$(
	scripts/ci/install-release-tool.sh \
		gitleaks "$version" gitleaks/gitleaks gitleaks gitleaks x64 arm64
)"
merge_base="$(git merge-base "$base" "$head")"

"$binary" version
"$binary" detect \
	--redact \
	--exit-code=1 \
	--config=.gitleaks.toml \
	--log-opts="${merge_base}..${head}"
