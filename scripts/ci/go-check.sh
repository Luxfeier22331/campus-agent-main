#!/usr/bin/env bash
set -euo pipefail

unformatted="$(gofmt -l apps/execution-control)"
if [[ -n "$unformatted" ]]; then
	printf '%s\n' "$unformatted"
	exit 1
fi

cd apps/execution-control
go vet ./...

go_path="$(go env GOPATH)"
export PATH="${go_path}/bin:${PATH}"
if ! command -v golangci-lint >/dev/null 2>&1; then
	echo "golangci-lint v2.11.4 is required" >&2
	exit 1
fi

golangci-lint run ./...
go test ./...
