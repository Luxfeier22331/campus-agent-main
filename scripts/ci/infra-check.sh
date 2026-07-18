#!/usr/bin/env bash
set -euo pipefail

conftest verify --policy infra/policies
while IFS= read -r kustomization; do
	directory="${kustomization%/kustomization.yaml}"
	kustomize build "$directory" | conftest test \
		--namespace campus.k8s.config_secrets \
		--policy infra/policies \
		--parser yaml \
		-
done < <(find infra/k8s -name kustomization.yaml -print | sort)
