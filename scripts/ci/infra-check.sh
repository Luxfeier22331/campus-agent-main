#!/usr/bin/env bash
set -euo pipefail

aqua exec -- conftest verify --policy infra/policies
while IFS= read -r kustomization; do
	directory="${kustomization%/kustomization.yaml}"
	aqua exec -- kustomize build "$directory" | aqua exec -- conftest test \
		--namespace campus.k8s.config_secrets \
		--policy infra/policies \
		--parser yaml \
		-
done < <(find infra/k8s -name kustomization.yaml -print | sort)
