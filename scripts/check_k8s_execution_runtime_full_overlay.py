from __future__ import annotations

import argparse
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_DEFAULT_OVERLAY = Path("infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full")
_REQUIRED_DEPLOYMENTS = {
    "cloudflared-execution-control",
    "execution-control",
    "agent-runtime",
    "workflow-worker",
    "activity-worker-core",
    "activity-worker-agent",
    "activity-worker-knowledge",
    "temporal-task-queue-sampler",
    "keda-hpa-posture-collector",
}
_REQUIRED_SERVICES = {
    "execution-control",
    "agent-runtime",
}
_FORBIDDEN_INGRESSES = {"execution-control-staging"}
_REQUIRED_SCALED_OBJECTS = {
    "workflow-worker",
    "activity-worker-core",
    "activity-worker-agent",
    "activity-worker-knowledge",
}
_FORBIDDEN_THIRD_PARTY_NAMES = {
    "campus-agent-postgres",
    "hindsight-api",
    "hindsight-postgres",
    "otel-collector",
    "qdrant",
    "temporal",
    "temporal-postgres",
    "temporal-ui",
}


@dataclass(frozen=True, slots=True)
class FullOverlayIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_full_overlay(
    *,
    root: Path | None = None,
    overlay: Path = _DEFAULT_OVERLAY,
) -> tuple[FullOverlayIssue, ...]:
    base = root or repo_root()
    overlay_path = base / overlay
    if not overlay_path.exists():
        return (
            FullOverlayIssue(
                path=overlay.as_posix(),
                message="nc-arm-6c full execution-runtime overlay is required",
            ),
        )

    docs, render_error = _render_overlay(overlay_path, base=base)
    if render_error:
        return (FullOverlayIssue(path=overlay.as_posix(), message=render_error),)

    issues: list[FullOverlayIssue] = []
    issues.extend(_require_kind_names(docs, overlay, "Deployment", _REQUIRED_DEPLOYMENTS))
    issues.extend(_require_kind_names(docs, overlay, "Service", _REQUIRED_SERVICES))
    issues.extend(_require_kind_names(docs, overlay, "ScaledObject", _REQUIRED_SCALED_OBJECTS))

    for doc in docs:
        name = _resource_name(doc)
        kind = str(doc.get("kind", ""))
        labels = doc.get("metadata", {}).get("labels", {})
        if isinstance(labels, dict) and labels.get("campus-agent.muc.wiki/external-runtime"):
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"full overlay must not include external-runtime resource {kind} {name}",
                )
            )
        if kind == "EndpointSlice":
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"full overlay must not include host-bridge EndpointSlice {name}",
                )
            )
        if kind == "Ingress" and name in _FORBIDDEN_INGRESSES:
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"full overlay must not expose retired public machine ingress {name}",
                )
            )
        if kind == "StatefulSet":
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"execution-runtime full overlay must not own StatefulSet {name}",
                )
            )
        if name in _FORBIDDEN_THIRD_PARTY_NAMES:
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"execution-runtime full overlay must not own platform resource {kind} {name}",
                )
            )
        if kind in {"Deployment", "StatefulSet"}:
            issues.extend(_audit_pod_spec(doc, overlay))
        if kind == "Service":
            selector = doc.get("spec", {}).get("selector")
            if name in _REQUIRED_SERVICES and not selector:
                issues.append(
                    FullOverlayIssue(
                        path=overlay.as_posix(),
                        message=f"full overlay Service must have a selector: {name}",
                    )
                )
        if kind == "Ingress":
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"execution-runtime full overlay must not expose Ingress {name}",
                )
            )

    return tuple(issues)


def _require_kind_names(
    docs: tuple[dict[str, Any], ...],
    overlay: Path,
    kind: str,
    expected: set[str],
) -> tuple[FullOverlayIssue, ...]:
    actual = {_resource_name(doc) for doc in docs if doc.get("kind") == kind}
    return tuple(
        FullOverlayIssue(path=overlay.as_posix(), message=f"required {kind} is missing: {name}")
        for name in sorted(expected - actual)
    )


def _audit_pod_spec(doc: dict[str, Any], overlay: Path) -> tuple[FullOverlayIssue, ...]:
    issues: list[FullOverlayIssue] = []
    name = _resource_name(doc)
    template = doc.get("spec", {}).get("template", {})
    pod_spec = template.get("spec", {}) if isinstance(template, dict) else {}
    for container in pod_spec.get("containers", []):
        if not isinstance(container, dict):
            continue
        for port in container.get("ports", []):
            if isinstance(port, dict) and ("hostPort" in port or "hostIP" in port):
                issues.append(
                    FullOverlayIssue(
                        path=overlay.as_posix(),
                        message=f"full overlay workload must not use hostPort/hostIP: {name}",
                    )
                )
        resources = container.get("resources")
        if (
            not isinstance(resources, dict)
            or "requests" not in resources
            or "limits" not in resources
        ):
            issues.append(
                FullOverlayIssue(
                    path=overlay.as_posix(),
                    message=f"workload container must declare requests and limits: {name}",
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


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--overlay", type=Path, default=_DEFAULT_OVERLAY)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    issues = audit_full_overlay(root=args.repo_root.resolve(), overlay=args.overlay)
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
