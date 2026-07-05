from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_BOUNDARY = Path("configs/runtime/k8s-execution-runtime-env-boundary.v1.json")
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
_SECRET_LIKE_PATTERN = (
    "SECRET",
    "PASSWORD",
    "API_KEY",
    "ACCESS_KEY",
    "PRIVATE_KEY",
    "AUTH_HEADER",
    "AUTH_VALUE",
    "DATABASE_URL",
    "BEARER_TOKEN",
    "TOKEN",
    "SALT",
)


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
    boundary, boundary_error = _load_boundary(base)
    if boundary_error:
        return (SlimOverlayIssue(path=_BOUNDARY.as_posix(), message=boundary_error),)
    retired_secret_names = set(boundary.get("retired_secret_names", []))
    slim_forbidden_secrets = set(boundary.get("slim_forbidden_secrets", []))
    configmap_keys = {key for keys in boundary.get("configmaps", {}).values() for key in keys}
    slim_profile = boundary.get("profiles", {}).get("nc-arm-6c-slim", {})
    slim_configmap_refs = set(slim_profile.get("configmaps", []))
    slim_config_keys = {
        key
        for name in slim_configmap_refs
        for key in boundary.get("configmaps", {}).get(str(name), [])
    }
    secret_keys = {key for keys in boundary.get("secrets", {}).values() for key in keys}
    issues.extend(_audit_boundary_profile_references(boundary))

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
        if kind == "Secret" and name in retired_secret_names:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"slim overlay must not include retired Secret {name}",
                )
            )
        if kind == "Secret" and name in slim_forbidden_secrets:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"slim overlay must not include forbidden Secret {name}",
                )
            )
        if kind == "ConfigMap":
            for key in _resource_data_keys(doc):
                if _is_secret_like_key(key):
                    issues.append(
                        SlimOverlayIssue(
                            path=_OVERLAY.as_posix(),
                            message=f"ConfigMap {name} contains secret-like key {key}",
                        )
                    )
                if key in secret_keys:
                    issues.append(
                        SlimOverlayIssue(
                            path=_OVERLAY.as_posix(),
                            message=f"ConfigMap {name} contains secret-owned key {key}",
                        )
                    )
        if kind == "Secret":
            for key in _resource_data_keys(doc):
                if key in configmap_keys:
                    issues.append(
                        SlimOverlayIssue(
                            path=_OVERLAY.as_posix(),
                            message=f"Secret {name} contains config-owned key {key}",
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

    issues.extend(_audit_workload_secret_boundaries(docs, boundary))
    issues.extend(_audit_workload_config_boundaries(docs, slim_configmap_refs, slim_config_keys))

    return tuple(issues)


def _load_boundary(base: Path) -> tuple[dict[str, Any], str | None]:
    try:
        payload = json.loads((base / _BOUNDARY).read_text(encoding="utf-8"))
    except OSError as exc:
        return {}, f"read K8s env boundary: {exc}"
    except json.JSONDecodeError as exc:
        return {}, f"invalid JSON: {exc}"
    if payload.get("schema_version") != "campus_k8s_execution_runtime_env_boundary.v1":
        return {}, "unsupported schema_version"
    return payload, None


def _audit_boundary_profile_references(boundary: dict[str, Any]) -> tuple[SlimOverlayIssue, ...]:
    issues: list[SlimOverlayIssue] = []
    sections = ("configmaps", "secrets", "files")
    profile_refs = {section: set() for section in sections}
    for profile_name, profile in boundary.get("profiles", {}).items():
        if not isinstance(profile, dict):
            issues.append(
                SlimOverlayIssue(
                    path=_BOUNDARY.as_posix(),
                    message=f"profile {profile_name} must be an object",
                )
            )
            continue
        for section in sections:
            refs = profile.get(section, [])
            if not isinstance(refs, list):
                issues.append(
                    SlimOverlayIssue(
                        path=_BOUNDARY.as_posix(),
                        message=f"profile {profile_name}.{section} must be a list",
                    )
                )
                continue
            profile_refs[section].update(str(ref) for ref in refs)

    for section in sections:
        defined = set(boundary.get(section, {}))
        unused = sorted(defined - profile_refs[section])
        for name in unused:
            issues.append(
                SlimOverlayIssue(
                    path=_BOUNDARY.as_posix(),
                    message=f"{section}.{name} is not referenced by any profile",
                )
            )
    issues.extend(_audit_unique_secret_keys(boundary))
    return tuple(issues)


def _audit_unique_secret_keys(boundary: dict[str, Any]) -> tuple[SlimOverlayIssue, ...]:
    issues: list[SlimOverlayIssue] = []
    owners: dict[str, str] = {}
    for name, keys in boundary.get("secrets", {}).items():
        if not isinstance(keys, list):
            issues.append(
                SlimOverlayIssue(
                    path=_BOUNDARY.as_posix(),
                    message=f"secrets.{name} must be a list",
                )
            )
            continue
        for raw_key in keys:
            key = str(raw_key)
            previous = owners.get(key)
            if previous is not None:
                issues.append(
                    SlimOverlayIssue(
                        path=_BOUNDARY.as_posix(),
                        message=f"secret key {key} appears in both {previous} and {name}",
                    )
                )
                continue
            owners[key] = str(name)
    return tuple(issues)


def _resource_data_keys(doc: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for field in ("data", "stringData"):
        values = doc.get(field)
        if isinstance(values, dict):
            keys.update(str(key) for key in values)
    return keys


def _is_secret_like_key(key: str) -> bool:
    return any(token in key for token in _SECRET_LIKE_PATTERN)


def _audit_workload_secret_boundaries(
    docs: tuple[dict[str, Any], ...],
    boundary: dict[str, Any],
) -> tuple[SlimOverlayIssue, ...]:
    issues: list[SlimOverlayIssue] = []
    retired_secret_names = set(boundary.get("retired_secret_names", []))
    slim_forbidden_secrets = set(boundary.get("slim_forbidden_secrets", []))
    expected_by_deployment = {
        "execution-control": {
            "execution-control-secrets",
            "execution-control-metrics-secrets",
            "execution-temporal-workflow-secrets",
            "execution-telemetry-client-secrets",
            "execution-run-projection-secrets",
            "execution-memory-client-secrets",
            "execution-control-internal-query-secrets",
            "execution-rag-secrets",
            "execution-tool-read-model-secrets",
        },
        "agent-runtime": {"agent-runtime-secrets"},
        "workflow-worker": {
            "execution-temporal-workflow-secrets",
            "execution-telemetry-client-secrets",
        },
        "activity-worker-core": {
            "execution-temporal-workflow-secrets",
            "execution-telemetry-client-secrets",
            "execution-run-projection-secrets",
            "execution-memory-client-secrets",
            "execution-control-internal-query-secrets",
            "execution-tool-read-model-secrets",
        },
        "activity-worker-agent": {
            "execution-temporal-workflow-secrets",
            "execution-telemetry-client-secrets",
            "execution-run-projection-secrets",
            "execution-agent-client-secrets",
        },
        "activity-worker-knowledge": {
            "execution-temporal-workflow-secrets",
            "execution-telemetry-client-secrets",
            "execution-run-projection-secrets",
            "execution-rag-secrets",
        },
    }
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        name = _resource_name(doc)
        if name not in expected_by_deployment:
            continue
        actual = _deployment_secret_refs(doc)
        forbidden = actual & (retired_secret_names | slim_forbidden_secrets)
        for secret_name in sorted(forbidden):
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=f"Deployment {name} references forbidden Secret {secret_name}",
                )
            )
        expected = expected_by_deployment[name]
        if actual != expected:
            issues.append(
                SlimOverlayIssue(
                    path=_OVERLAY.as_posix(),
                    message=(
                        f"Deployment {name} Secret refs = {sorted(actual)}, want {sorted(expected)}"
                    ),
                )
            )
        issues.extend(_audit_provider_projection_mounts(doc))
    return tuple(issues)


def _deployment_secret_refs(doc: dict[str, Any]) -> set[str]:
    refs: set[str] = set()
    for container in _deployment_containers(doc):
        for entry in container.get("envFrom", []):
            secret_ref = entry.get("secretRef") if isinstance(entry, dict) else None
            if isinstance(secret_ref, dict) and secret_ref.get("name"):
                refs.add(str(secret_ref["name"]))
    return refs


def _audit_workload_config_boundaries(
    docs: tuple[dict[str, Any], ...],
    allowed_configmap_refs: set[str],
    slim_config_keys: set[str],
) -> tuple[SlimOverlayIssue, ...]:
    issues: list[SlimOverlayIssue] = []
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        name = _resource_name(doc)
        for container in _deployment_containers(doc):
            for entry in container.get("envFrom", []):
                config_map_ref = entry.get("configMapRef") if isinstance(entry, dict) else None
                if not isinstance(config_map_ref, dict):
                    continue
                ref_name = str(config_map_ref.get("name", ""))
                if ref_name not in allowed_configmap_refs:
                    issues.append(
                        SlimOverlayIssue(
                            path=_OVERLAY.as_posix(),
                            message=(f"Deployment {name} references non-slim ConfigMap {ref_name}"),
                        )
                    )
            for env in container.get("env", []):
                if not isinstance(env, dict):
                    continue
                key = str(env.get("name", ""))
                if key in slim_config_keys:
                    issues.append(
                        SlimOverlayIssue(
                            path=_OVERLAY.as_posix(),
                            message=(
                                f"Deployment {name} redeclares rendered ConfigMap key {key} "
                                "as Pod env"
                            ),
                        )
                    )
    return tuple(issues)


def _deployment_containers(doc: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    template = doc.get("spec", {}).get("template", {})
    pod_spec = template.get("spec", {}) if isinstance(template, dict) else {}
    containers = pod_spec.get("containers", []) if isinstance(pod_spec, dict) else []
    return tuple(container for container in containers if isinstance(container, dict))


def _audit_provider_projection_mounts(doc: dict[str, Any]) -> tuple[SlimOverlayIssue, ...]:
    issues: list[SlimOverlayIssue] = []
    name = _resource_name(doc)
    template = doc.get("spec", {}).get("template", {})
    pod_spec = template.get("spec", {}) if isinstance(template, dict) else {}
    volumes = pod_spec.get("volumes", []) if isinstance(pod_spec, dict) else []
    for volume in volumes:
        if not isinstance(volume, dict):
            continue
        if volume.get("name") == "provider-config-projection":
            secret = volume.get("secret")
            if not isinstance(secret, dict):
                issues.append(
                    SlimOverlayIssue(
                        path=_OVERLAY.as_posix(),
                        message=f"Deployment {name} provider projection must be a Secret volume",
                    )
                )
                continue
            if secret.get("secretName") != "execution-runtime-provider-config-projection":
                issues.append(
                    SlimOverlayIssue(
                        path=_OVERLAY.as_posix(),
                        message=f"Deployment {name} provider projection Secret name is invalid",
                    )
                )
            if secret.get("defaultMode") != 0o600:
                issues.append(
                    SlimOverlayIssue(
                        path=_OVERLAY.as_posix(),
                        message=f"Deployment {name} provider projection Secret volume must use defaultMode 0600",
                    )
                )
        if volume.get("name") == "qdrant-tls-ca":
            config_map = volume.get("configMap")
            if (
                not isinstance(config_map, dict)
                or config_map.get("name") != "execution-runtime-qdrant-tls-ca"
            ):
                issues.append(
                    SlimOverlayIssue(
                        path=_OVERLAY.as_posix(),
                        message=f"Deployment {name} Qdrant CA must be mounted from ConfigMap",
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
