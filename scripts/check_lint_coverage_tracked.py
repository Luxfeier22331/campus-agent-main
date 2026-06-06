from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_BINARY_SUFFIXES = {
    ".avif",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".svg",
    ".webp",
}
_DOCKER_NAMES = (".hadolint.yaml",)
_EDITORCONFIG_NAMES = (".editorconfig", ".gitattributes", ".gitignore")
_ENV_SUFFIXES = (".env.example", ".local.example", ".dev.vars.example")
_EXCLUDED_GENERATED_FILES: dict[str, str] = {}
_HANDWRITTEN_DECOMPOSITION_SUFFIXES = {
    ".cjs",
    ".go",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    ".ts",
    ".tsx",
}
_JS_LIKE_SUFFIXES = {
    ".cjs",
    ".css",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".mjs",
    ".mts",
    ".ts",
    ".tsx",
}
_MARKDOWN_ROOT_FILES = {
    ".github/pull_request_template.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "README.md",
}
_ROOT_BIOME_FILES = {
    ".markdownlint-cli2.jsonc",
    "biome.jsonc",
    "package.json",
    "turbo.json",
}
_ROOT_LOCK_FILES = {"pnpm-lock.yaml", "uv.lock"}
_ROOT_SQL_LINT_FILES = {".sqlfluff"}
_LEGACY_OFFICE_JAVA_PREFIX = "apps/legacy-office-conversion-service/src/"
_TEXT_LIKE_SUFFIXES = {
    ".cjs",
    ".css",
    ".env",
    ".example",
    ".go",
    ".gitignore",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsonc",
    ".jsonl",
    ".jsx",
    ".md",
    ".mdx",
    ".mjs",
    ".mts",
    ".py",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
}
_WEB_LINT_PREFIXES = ("apps/", "configs/", "packages/", "scripts/", "tests/")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_lint_candidate_paths(*, root: Path | None = None) -> tuple[str, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z"],
        check=True,
        capture_output=True,
        cwd=base,
    )
    return tuple(
        decoded
        for item in result.stdout.split(b"\0")
        if item
        for decoded in [item.decode("utf-8")]
        if _is_lint_candidate_path(decoded) and (base / decoded).exists()
    )


def lint_exclusion_reason(path: str) -> str | None:
    if path.startswith(".planning/"):
        return "planning_artifact"
    if path.startswith(".tmp/"):
        return "temporary_workspace_artifact"
    if path.startswith(".worktrees/"):
        return "worktree_runtime_artifact"
    if path.startswith("apps/public-docs/docs/.generated/course-maps/"):
        return "generated_public_docs_course_map_data"
    if path.startswith("apps/public-chat-web/vendor/"):
        return "vendor_snapshot"
    if path.startswith("apps/app-api/drizzle/meta/"):
        return "generated_drizzle_metadata"
    if path in _EXCLUDED_GENERATED_FILES:
        return _EXCLUDED_GENERATED_FILES[path]
    if path.startswith("docs/plans/"):
        return "archived_plan_documentation"
    if path.startswith("docs/") and "/archive/" in path:
        return "archived_reference_documentation"
    if Path(path).suffix.lower() in _BINARY_SUFFIXES:
        return "binary_asset"
    return None


def tracked_handwritten_code_paths(*, root: Path | None = None) -> tuple[str, ...]:
    return tuple(
        path for path in tracked_lint_candidate_paths(root=root) if is_handwritten_code_path(path)
    )


def is_handwritten_code_path(path: str) -> bool:
    return (
        lint_exclusion_reason(path) is None
        and Path(path).suffix.lower() in _HANDWRITTEN_DECOMPOSITION_SUFFIXES
    )


def lint_families_for_path(path: str) -> tuple[str, ...]:
    families: list[str] = []
    if _is_biome_tracked_file(path):
        families.append("web:lint")
    if _is_public_docs_generated_file(path):
        families.append("public-docs:lint")
    if _is_markdown_tracked_file(path):
        families.append("docs:lint")
    if _is_python_tracked_file(path):
        families.extend(("py:lint", "py:format:check"))
    if _is_go_tracked_file(path):
        families.append("go:static:check")
    if path.endswith((".yaml", ".yml")):
        families.append("yaml:lint")
    if path.endswith(".toml"):
        families.append("toml:lint")
    if path.endswith(".sh"):
        families.append("shell:lint")
    if path.endswith(".xml"):
        families.append("xml:lint")
    if path.endswith(".jsonl"):
        families.append("jsonl:lint")
    if _is_legacy_office_java_tracked_file(path):
        families.append("java:lint")
    if path.endswith(".sql") or path in _ROOT_SQL_LINT_FILES:
        families.append("sql:lint")
    if _is_docker_tracked_file(path):
        families.append("docker:lint")
    if _is_env_tracked_file(path):
        families.append("env:lint")
    if _is_editorconfig_tracked_file(path):
        families.append("editorconfig:lint")
    if path in _ROOT_LOCK_FILES or path.endswith("/pnpm-lock.yaml"):
        families.append("lock:lint")
    if path.endswith(".html"):
        families.append("html:lint")
    return tuple(dict.fromkeys(families))


def audit_lint_coverage(*, root: Path | None = None) -> tuple[str, ...]:
    failures: list[str] = []
    for path in tracked_lint_candidate_paths(root=root):
        if lint_exclusion_reason(path) is not None:
            continue
        families = lint_families_for_path(path)
        if not families:
            failures.append(path)
    return tuple(failures)


def _is_biome_tracked_file(path: str) -> bool:
    if path in _ROOT_BIOME_FILES:
        return True
    if Path(path).suffix.lower() not in _JS_LIKE_SUFFIXES:
        return False
    return path.startswith(_WEB_LINT_PREFIXES)


def _is_markdown_tracked_file(path: str) -> bool:
    if path in _MARKDOWN_ROOT_FILES:
        return True
    if path.startswith("docs/"):
        return (
            path.endswith(".md") and "/archive/" not in path and not path.startswith("docs/plans/")
        )
    if path.startswith("apps/public-docs/docs/"):
        return False
    if path.startswith(("apps/", "packages/", "configs/", "infra/")):
        return path.endswith(".md")
    return False


def _is_public_docs_generated_file(path: str) -> bool:
    if not path.startswith("apps/public-docs/docs/"):
        return False
    if path.startswith("apps/public-docs/docs/.generated/"):
        return False
    return path.endswith((".md", ".mdx"))


def _is_python_tracked_file(path: str) -> bool:
    return path.endswith(".py") and not path.startswith(
        (
            ".planning/",
            ".tmp/",
            ".worktrees/",
            "apps/public-chat-web/vendor/",
            "apps/app-api/drizzle/meta/",
        )
    )


def _is_go_tracked_file(path: str) -> bool:
    return path.startswith("apps/execution-gateway/") and path.endswith(".go")


def _is_docker_tracked_file(path: str) -> bool:
    return (
        Path(path).name.startswith("Dockerfile")
        or path.endswith(".dockerfile")
        or path in _DOCKER_NAMES
    )


def _is_legacy_office_java_tracked_file(path: str) -> bool:
    return path.startswith(_LEGACY_OFFICE_JAVA_PREFIX) and path.endswith(".java")


def _is_env_tracked_file(path: str) -> bool:
    return path.endswith(_ENV_SUFFIXES)


def _is_editorconfig_tracked_file(path: str) -> bool:
    name = Path(path).name
    return name in _EDITORCONFIG_NAMES


def _is_lint_candidate_path(path: str) -> bool:
    name = Path(path).name
    suffix = Path(path).suffix.lower()
    if lint_exclusion_reason(path) is not None:
        return True
    if (
        path in _ROOT_BIOME_FILES
        or path in _MARKDOWN_ROOT_FILES
        or path in _ROOT_LOCK_FILES
        or path in _ROOT_SQL_LINT_FILES
    ):
        return True
    if name in _DOCKER_NAMES or name in _EDITORCONFIG_NAMES:
        return True
    if name.startswith("Dockerfile"):
        return True
    if path.endswith(_ENV_SUFFIXES):
        return True
    return suffix in _TEXT_LIKE_SUFFIXES


def main() -> int:
    failures = audit_lint_coverage()
    if failures:
        print("Tracked lint coverage check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(
        f"Validated tracked lint coverage for {len(tracked_lint_candidate_paths())} candidate files."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
