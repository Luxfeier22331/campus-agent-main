from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from scripts.worktree_file_discovery import worktree_paths

_GITOPS_ROOT = Path("infra/gitops")
_APP_DIR = _GITOPS_ROOT / "apps"
_SECRET_DIR = _GITOPS_ROOT / "secrets"
_SECRET_DELIVERY_README = _GITOPS_ROOT / "secrets" / "README.md"
_CAMPUS_AGENT_REPO_URL = "https://github.com/MUC-WIKI/campus-agent.git"
_SECRET_NAME_PATTERN = re.compile(
    r"(api[_-]?key|secret|token|password|dsn|database[_-]?url|private[_-]?key)",
    re.IGNORECASE,
)
_FORBIDDEN_PROVIDER_KEYS = {
    "LLM_API_KEY",
    "EMBEDDING_API_KEY",
    "RERANK_API_KEY",
    "PUBLIC_WEB_SEARCH_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "PERPLEXITY_API_KEY",
    "TAVILY_API_KEY",
    "EXA_API_KEY",
}
_WIDE_SEALED_SECRET_ANNOTATIONS = {
    "sealedsecrets.bitnami.com/namespace-wide",
    "sealedsecrets.bitnami.com/cluster-wide",
}
_WIDE_SEALED_SECRET_SCOPES = {"namespace-wide", "cluster-wide"}
_FORBIDDEN_SECRET_DELIVERY_NAME_PATTERNS = (
    ".local.",
    ".backup.",
)


@dataclass(frozen=True)
class GitOpsSkeletonIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_gitops_skeleton(*, root: Path | None = None) -> tuple[GitOpsSkeletonIssue, ...]:
    base = root or repo_root()
    issues: list[GitOpsSkeletonIssue] = []

    if not (base / _SECRET_DELIVERY_README).exists():
        issues.append(
            GitOpsSkeletonIssue(
                path=_SECRET_DELIVERY_README.as_posix(),
                message="GitOps secret delivery contract README is required",
            )
        )

    app_files = tuple(sorted((base / _APP_DIR).glob("*.yaml")))
    for path in app_files:
        issues.extend(_audit_application(path, base=base))

    for path in _gitops_text_files(base):
        issues.extend(_audit_secret_like_text(path, base=base))

    for path in _gitops_secret_manifest_files(base):
        issues.extend(_audit_secret_delivery_manifest(path, base=base))

    return tuple(issues)


def _audit_application(path: Path, *, base: Path) -> tuple[GitOpsSkeletonIssue, ...]:
    relative = path.relative_to(base).as_posix()
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return (GitOpsSkeletonIssue(path=relative, message=f"invalid YAML: {exc}"),)

    issues: list[GitOpsSkeletonIssue] = []
    if not isinstance(payload, dict):
        return (
            GitOpsSkeletonIssue(path=relative, message="Application file must be a YAML object"),
        )
    if payload.get("apiVersion") != "argoproj.io/v1alpha1" or payload.get("kind") != "Application":
        issues.append(
            GitOpsSkeletonIssue(path=relative, message="must define an Argo CD Application")
        )
        return tuple(issues)

    spec = payload.get("spec")
    if not isinstance(spec, dict):
        issues.append(GitOpsSkeletonIssue(path=relative, message="Application spec is required"))
        return tuple(issues)

    sources = _application_sources(spec)
    if not sources:
        issues.append(
            GitOpsSkeletonIssue(path=relative, message="Application must define source(s)")
        )
        return tuple(issues)

    value_ref_sources = {
        _string(source.get("ref")): _string(source.get("repoURL"))
        for source in sources
        if _string(source.get("ref"))
    }
    for index, source in enumerate(sources):
        issues.extend(
            _audit_source(
                source,
                source_index=index,
                app_path=relative,
                base=base,
                value_ref_sources=value_ref_sources,
            )
        )

    destination = spec.get("destination")
    if not isinstance(destination, dict):
        issues.append(
            GitOpsSkeletonIssue(path=relative, message="Application destination is required")
        )
    elif not destination.get("namespace"):
        issues.append(
            GitOpsSkeletonIssue(
                path=relative, message="Application destination.namespace is required"
            )
        )

    return tuple(issues)


def _application_sources(spec: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    sources = spec.get("sources")
    if isinstance(sources, list):
        return tuple(source for source in sources if isinstance(source, dict))
    source = spec.get("source")
    if isinstance(source, dict):
        return (source,)
    return ()


def _audit_source(
    source: dict[str, Any],
    *,
    source_index: int,
    app_path: str,
    base: Path,
    value_ref_sources: dict[str, str],
) -> tuple[GitOpsSkeletonIssue, ...]:
    issues: list[GitOpsSkeletonIssue] = []
    prefix = f"source[{source_index}]"
    repo_url = _string(source.get("repoURL"))
    if repo_url == "":
        issues.append(GitOpsSkeletonIssue(path=app_path, message=f"{prefix}.repoURL is required"))

    chart = _string(source.get("chart"))
    path_value = _string(source.get("path"))
    ref = _string(source.get("ref"))
    target_revision = _string(source.get("targetRevision"))
    if target_revision == "":
        issues.append(
            GitOpsSkeletonIssue(path=app_path, message=f"{prefix}.targetRevision is required")
        )
    elif repo_url == _CAMPUS_AGENT_REPO_URL and target_revision == "develop":
        issues.append(
            GitOpsSkeletonIssue(
                path=app_path,
                message=f"{prefix}.targetRevision must not use retired develop branch",
            )
        )

    if chart and path_value:
        issues.append(
            GitOpsSkeletonIssue(path=app_path, message=f"{prefix} must not set both chart and path")
        )
    if not chart and not path_value and not ref:
        issues.append(
            GitOpsSkeletonIssue(path=app_path, message=f"{prefix} must set chart, path or ref")
        )

    if path_value:
        if repo_url != _CAMPUS_AGENT_REPO_URL:
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path,
                    message=f"{prefix}.path source must use campus-agent repository",
                )
            )
        elif not (base / path_value).exists():
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path, message=f"{prefix}.path does not exist: {path_value}"
                )
            )

    if chart:
        issues.extend(
            _audit_helm_source(
                source,
                source_index=source_index,
                app_path=app_path,
                base=base,
                value_ref_sources=value_ref_sources,
            )
        )

    return tuple(issues)


def _audit_helm_source(
    source: dict[str, Any],
    *,
    source_index: int,
    app_path: str,
    base: Path,
    value_ref_sources: dict[str, str],
) -> tuple[GitOpsSkeletonIssue, ...]:
    issues: list[GitOpsSkeletonIssue] = []
    prefix = f"source[{source_index}]"
    if _string(source.get("targetRevision")) in {"", "HEAD", "develop", "main", "latest"}:
        issues.append(
            GitOpsSkeletonIssue(path=app_path, message=f"{prefix} Helm chart must pin a version")
        )

    helm = source.get("helm")
    if not isinstance(helm, dict):
        issues.append(GitOpsSkeletonIssue(path=app_path, message=f"{prefix}.helm is required"))
        return tuple(issues)

    value_files = helm.get("valueFiles")
    if not isinstance(value_files, list) or not value_files:
        issues.append(
            GitOpsSkeletonIssue(path=app_path, message=f"{prefix}.helm.valueFiles is required")
        )
        return tuple(issues)

    for raw_value_file in value_files:
        value_file = _string(raw_value_file)
        if not value_file.startswith("$values/"):
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path,
                    message=f"{prefix}.helm.valueFiles must use $values/ repo references",
                )
            )
            continue
        if value_ref_sources.get("values") != _CAMPUS_AGENT_REPO_URL:
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path,
                    message=(
                        f"{prefix}.helm.valueFiles uses $values but Application lacks "
                        "campus-agent source with ref: values"
                    ),
                )
            )
            continue
        relative_value_file = value_file.removeprefix("$values/")
        value_path = base / relative_value_file
        if not value_path.exists():
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path,
                    message=f"{prefix}.helm.valueFiles missing file: {relative_value_file}",
                )
            )
            continue
        if not relative_value_file.startswith("infra/gitops/values/"):
            issues.append(
                GitOpsSkeletonIssue(
                    path=app_path,
                    message=f"{prefix}.helm.valueFiles must stay under infra/gitops/values",
                )
            )

    return tuple(issues)


def _audit_secret_like_text(path: Path, *, base: Path) -> tuple[GitOpsSkeletonIssue, ...]:
    relative = path.relative_to(base).as_posix()
    text = path.read_text(encoding="utf-8")
    issues: list[GitOpsSkeletonIssue] = []
    for forbidden_key in sorted(_FORBIDDEN_PROVIDER_KEYS):
        if forbidden_key in text:
            issues.append(
                GitOpsSkeletonIssue(
                    path=relative,
                    message=f"GitOps skeleton must not reference provider secret key {forbidden_key}",
                )
            )
    local_env_pattern = re.compile(
        r"(^|[/\s'\"`])(\.dev\.vars|\.env(?:\.[A-Za-z0-9_-]+)?)($|[/\s'\"`])"
    )
    if local_env_pattern.search(text):
        issues.append(
            GitOpsSkeletonIssue(
                path=relative,
                message="GitOps skeleton must not reference local env or .dev.vars files",
            )
        )
    return tuple(issues)


def _audit_secret_delivery_manifest(path: Path, *, base: Path) -> tuple[GitOpsSkeletonIssue, ...]:
    relative = path.relative_to(base).as_posix()
    filename = path.name.lower()
    if any(pattern in filename for pattern in _FORBIDDEN_SECRET_DELIVERY_NAME_PATTERNS):
        return (
            GitOpsSkeletonIssue(
                path=relative,
                message=(
                    "GitOps secret delivery must not track local plaintext inputs "
                    "or backup manifests"
                ),
            ),
        )

    try:
        documents = tuple(yaml.safe_load_all(path.read_text(encoding="utf-8")))
    except yaml.YAMLError as exc:
        return (GitOpsSkeletonIssue(path=relative, message=f"invalid YAML: {exc}"),)

    issues: list[GitOpsSkeletonIssue] = []
    for index, payload in enumerate(documents):
        if payload is None:
            continue
        if not isinstance(payload, dict):
            issues.append(
                GitOpsSkeletonIssue(
                    path=relative,
                    message=f"secret delivery document[{index}] must be a YAML object",
                )
            )
            continue

        kind = _string(payload.get("kind"))
        if kind == "Secret" and "sops" not in payload:
            issues.append(
                GitOpsSkeletonIssue(
                    path=relative,
                    message=(
                        "GitOps secret delivery must not track plaintext Kubernetes "
                        "Secret; use SealedSecret, ExternalSecret, SOPS-encrypted "
                        "Secret or an operator runbook"
                    ),
                )
            )
        if kind == "SealedSecret" and not _has_non_empty_encrypted_data(payload):
            issues.append(
                GitOpsSkeletonIssue(
                    path=relative,
                    message="SealedSecret manifests must contain non-empty spec.encryptedData",
                )
            )

        for annotation, value in _wide_sealed_secret_scope_annotations(payload):
            issues.append(
                GitOpsSkeletonIssue(
                    path=relative,
                    message=(
                        "SealedSecret manifests must use strict scope by default; "
                        f"remove {annotation}={value}"
                    ),
                )
            )

    return tuple(issues)


def _has_non_empty_encrypted_data(payload: dict[str, object]) -> bool:
    spec = payload.get("spec")
    if not isinstance(spec, dict):
        return False
    encrypted_data = spec.get("encryptedData")
    return isinstance(encrypted_data, dict) and bool(encrypted_data)


def _wide_sealed_secret_scope_annotations(payload: object) -> tuple[tuple[str, str], ...]:
    matches: list[tuple[str, str]] = []
    if isinstance(payload, dict):
        annotations = payload.get("annotations")
        if isinstance(annotations, dict):
            for key, value in annotations.items():
                annotation = _string(key)
                normalized = _string(value).lower()
                if annotation in _WIDE_SEALED_SECRET_ANNOTATIONS and normalized == "true":
                    matches.append((annotation, normalized))
                if (
                    annotation == "sealedsecrets.bitnami.com/scope"
                    and normalized in _WIDE_SEALED_SECRET_SCOPES
                ):
                    matches.append((annotation, normalized))
        for value in payload.values():
            matches.extend(_wide_sealed_secret_scope_annotations(value))
    elif isinstance(payload, list):
        for value in payload:
            matches.extend(_wide_sealed_secret_scope_annotations(value))
    return tuple(matches)


def _gitops_secret_manifest_files(base: Path) -> tuple[Path, ...]:
    secret_dir = base / _SECRET_DIR
    if not secret_dir.exists():
        return ()
    return tuple(
        sorted(
            path
            for path in secret_dir.rglob("*")
            if path.is_file() and path.suffix in {".yaml", ".yml"}
        )
    )


def _gitops_text_files(base: Path) -> tuple[Path, ...]:
    try:
        candidates = worktree_paths("infra/gitops", root=base)
    except Exception:
        candidates = tuple((base / _GITOPS_ROOT).rglob("*"))
    return tuple(
        path
        for path in candidates
        if path.exists() and path.is_file() and path.suffix in {".md", ".yaml", ".yml"}
    )


def _string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def main() -> int:
    issues = audit_gitops_skeleton()
    if not issues:
        print("Validated GitOps skeleton.")
        return 0
    for issue in issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
