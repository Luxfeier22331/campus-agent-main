from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_OVERLAY = Path("infra/k8s/execution-runtime/overlays/nc-arm-6c-staging")
_REQUIRED_DEPLOYMENTS = {
    "execution-control",
    "agent-runtime",
    "workflow-worker",
    "activity-worker-core",
    "activity-worker-agent",
    "activity-worker-knowledge",
}
_REQUIRED_EXTERNAL_SERVICES = {
    "temporal",
    "hindsight-api",
    "qdrant",
    "campus-agent-postgres",
    "otel-collector",
}
_FORBIDDEN_KINDS = {"StatefulSet", "ScaledObject", "TriggerAuthentication"}
_FORBIDDEN_NAMES = {
    "temporal-ui",
    "temporal-postgres",
    "hindsight-postgres",
    "temporal-task-queue-sampler",
    "keda-hpa-posture-collector",
    "keda-hpa-posture-reader",
    "execution-runtime-temporal-keda-ingress",
    "temporal-namespace-setup",
}


@dataclass(frozen=True, slots=True)
class SlimOverlayIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_slim_overlay(*, root: Path | None = None) -> tuple[SlimOverlayIssue, ...]:
    base = root or repo_root()
    overlay = base / _OVERLAY
    if not overlay.exists():
        return (
            SlimOverlayIssue(
                path=_OVERLAY.as_posix(),
                message="nc-arm-6c execution-runtime slim overlay is required",
            ),
        )

    issues: list[SlimOverlayIssue] = []
    docs, render_error = _render_overlay(overlay, base=base)
    if render_error:
        return (SlimOverlayIssue(path=_OVERLAY.as_posix(), message=render_error),)

    for doc in docs:
        kind = str(doc.get("kind", ""))
        name = _resource_name(doc)
        if kind in _FORBIDDEN_KINDS:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"slim overlay must not include {kind} {name}",
                )
            )
        if name in _FORBIDDEN_NAMES:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"slim overlay must not include {name}",
                )
            )

    deployments = _names_for_kind(docs, "Deployment")
    for name in sorted(_REQUIRED_DEPLOYMENTS - deployments):
        issues.append(
            SlimOverlayIssue(
                path=_OVERLAY.as_posix(),
                message=f"required Deployment is missing: {name}",
            )
        )

    services = _names_for_kind(docs, "Service")
    endpoint_slices = _names_for_kind(docs, "EndpointSlice")
    for name in sorted(_REQUIRED_EXTERNAL_SERVICES):
        if name not in services:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"external dependency Service is missing: {name}",
                )
            )
        if name not in endpoint_slices:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"external dependency EndpointSlice is missing: {name}",
                )
            )
            continue

        service = next(
            doc for doc in docs if doc.get("kind") == "Service" and _resource_name(doc) == name
        )
        selector = service.get("spec", {}).get("selector")
        if selector:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"external dependency Service must be selector-less: {name}",
                )
            )

        endpoint_slice = next(
            doc
            for doc in docs
            if doc.get("kind") == "EndpointSlice" and _resource_name(doc) == name
        )
        endpoint_addresses = [
            address
            for endpoint in endpoint_slice.get("endpoints", [])
            for address in endpoint.get("addresses", [])
        ]
        if endpoint_addresses != ["10.42.0.1"]:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"external dependency EndpointSlice must target 10.42.0.1: {name}",
                )
            )

    return tuple(issues)


def _render_overlay(overlay: Path, *, base: Path) -> tuple[tuple[dict[str, Any], ...], str | None]:
    result = subprocess.run(
        ("kubectl", "kustomize", overlay.relative_to(base).as_posix()),
        cwd=base,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return (), result.stderr.strip() or result.stdout.strip() or "kubectl kustomize failed"

    try:
        docs = tuple(doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict))
    except yaml.YAMLError as exc:
        return (), f"rendered overlay is invalid YAML: {exc}"
    return docs, None


def _resource_name(doc: dict[str, Any]) -> str:
    metadata = doc.get("metadata")
    if not isinstance(metadata, dict):
        return ""
    return str(metadata.get("name", ""))


def _names_for_kind(docs: tuple[dict[str, Any], ...], kind: str) -> set[str]:
    return {_resource_name(doc) for doc in docs if doc.get("kind") == kind}


def main() -> int:
    issues = audit_slim_overlay()
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
