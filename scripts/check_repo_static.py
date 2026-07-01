from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.check_java_tracked import affected_java_lint_required
from scripts.worktree_file_discovery import changed_worktree_paths


@dataclass(frozen=True, slots=True)
class StaticCheck:
    label: str
    command: tuple[str, ...]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def repo_static_checks() -> tuple[StaticCheck, ...]:
    py = sys.executable
    return (
        StaticCheck("biome tracked files", (py, "-m", "scripts.check_biome_tracked")),
        StaticCheck("markdown tracked files", (py, "-m", "scripts.check_markdown_tracked")),
        StaticCheck("docs frontmatter", (py, "-m", "scripts.check_docs_frontmatter_tracked")),
        StaticCheck(
            "docs reference graph", (py, "-m", "scripts.check_docs_reference_graph_tracked")
        ),
        StaticCheck("lint coverage", (py, "-m", "scripts.check_lint_coverage_tracked")),
        StaticCheck("decomposition", (py, "-m", "scripts.check_decomposition_tracked")),
        StaticCheck("java tracked files", (py, "-m", "scripts.check_java_tracked")),
        StaticCheck("editorconfig", (py, "-m", "scripts.check_editorconfig_tracked")),
        StaticCheck("env examples", (py, "-m", "scripts.check_env_example_tracked")),
        StaticCheck("env surface policy", (py, "-m", "scripts.check_env_surface_policy")),
        StaticCheck("html tracked files", (py, "-m", "scripts.check_html_tracked")),
        StaticCheck("yaml tracked files", (py, "-m", "scripts.check_yaml_tracked")),
        StaticCheck("toml syntax", (py, "-m", "scripts.check_toml_syntax")),
        StaticCheck("shell tracked files", (py, "-m", "scripts.check_shell_tracked")),
        StaticCheck("xml tracked files", (py, "-m", "scripts.check_xml_tracked")),
        StaticCheck("jsonl tracked files", (py, "-m", "scripts.check_jsonl_tracked")),
        StaticCheck(
            "public fixture source cleanliness",
            (py, "-m", "scripts.check_public_fixture_source_clean"),
        ),
        StaticCheck(
            "public asset source cleanliness",
            (py, "-m", "scripts.check_public_asset_source_clean"),
        ),
        StaticCheck(
            "source-derived config cleanliness",
            (py, "-m", "scripts.check_source_derived_config_clean"),
        ),
        StaticCheck(
            "public source-token cleanliness",
            (py, "-m", "scripts.check_public_source_tokens"),
        ),
        StaticCheck(
            "open-source metadata",
            (py, "-m", "scripts.check_open_source_metadata"),
        ),
        StaticCheck(
            "dependency license policy",
            (py, "-m", "scripts.check_dependency_license_policy"),
        ),
        StaticCheck(
            "object-store bucket policy",
            (py, "-m", "scripts.check_object_store_bucket_policy"),
        ),
        StaticCheck("sql tracked files", (py, "-m", "scripts.check_sql_tracked")),
        StaticCheck("docker tracked files", (py, "-m", "scripts.check_dockerfile_tracked")),
        StaticCheck("pnpm lock", (py, "-m", "scripts.check_pnpm_lock_tracked")),
        StaticCheck("uv lock", (py, "-m", "scripts.check_uv_lock")),
        StaticCheck(
            "ingestion task executability",
            (py, "-m", "scripts.check_ingestion_task_executability"),
        ),
        StaticCheck(
            "retired dependency tokens",
            (py, "-m", "scripts.check_retired_dependency_tokens"),
        ),
        StaticCheck("ruff check", ("ruff", "check", ".")),
        StaticCheck("ruff format", ("ruff", "format", ".", "--check")),
        StaticCheck("ci workflow contracts", (py, "-m", "scripts.check_ci_workflow_contracts")),
    )


def affected_repo_static_checks(
    paths: tuple[str, ...], *, py: str | None = None
) -> tuple[StaticCheck, ...]:
    python = py or sys.executable
    checks: list[StaticCheck] = []
    if any(_is_biome_path(path) for path in paths):
        checks.append(
            StaticCheck("biome affected files", (python, "-m", "scripts.check_biome_tracked"))
        )
    if any(_is_markdown_path(path) for path in paths):
        checks.extend(
            (
                StaticCheck(
                    "markdown tracked files", (python, "-m", "scripts.check_markdown_tracked")
                ),
                StaticCheck(
                    "docs frontmatter",
                    (python, "-m", "scripts.check_docs_frontmatter_tracked"),
                ),
                StaticCheck(
                    "docs reference graph",
                    (python, "-m", "scripts.check_docs_reference_graph_tracked"),
                ),
            )
        )
    if any(_is_lint_coverage_path(path) for path in paths):
        checks.append(
            StaticCheck("lint coverage", (python, "-m", "scripts.check_lint_coverage_tracked"))
        )
    if any(_is_decomposition_path(path) for path in paths):
        checks.append(
            StaticCheck("decomposition", (python, "-m", "scripts.check_decomposition_tracked"))
        )
    if affected_java_lint_required(paths):
        checks.append(
            StaticCheck("java tracked files", (python, "-m", "scripts.check_java_tracked"))
        )
    if any(_is_editorconfig_path(path) for path in paths):
        checks.append(
            StaticCheck("editorconfig", (python, "-m", "scripts.check_editorconfig_tracked"))
        )
    if any(_is_env_path(path) for path in paths):
        checks.extend(
            (
                StaticCheck("env examples", (python, "-m", "scripts.check_env_example_tracked")),
                StaticCheck(
                    "env surface policy", (python, "-m", "scripts.check_env_surface_policy")
                ),
            )
        )
    if any(path.endswith(".html") for path in paths):
        checks.append(
            StaticCheck("html tracked files", (python, "-m", "scripts.check_html_tracked"))
        )
    if any(path.endswith((".yaml", ".yml")) for path in paths):
        checks.append(
            StaticCheck("yaml tracked files", (python, "-m", "scripts.check_yaml_tracked"))
        )
    if any(path.endswith(".toml") for path in paths):
        checks.append(StaticCheck("toml syntax", (python, "-m", "scripts.check_toml_syntax")))
    if any(path.endswith(".sh") for path in paths):
        checks.append(
            StaticCheck(
                "shell affected files",
                (python, "-m", "scripts.check_shell_tracked", "--affected", *paths),
            )
        )
    if any(path.endswith(".xml") for path in paths):
        checks.append(StaticCheck("xml tracked files", (python, "-m", "scripts.check_xml_tracked")))
    if any(path.endswith(".jsonl") for path in paths):
        checks.append(
            StaticCheck("jsonl tracked files", (python, "-m", "scripts.check_jsonl_tracked"))
        )
    if any(_is_sql_path(path) for path in paths):
        checks.append(StaticCheck("sql tracked files", (python, "-m", "scripts.check_sql_tracked")))
    if any(_is_docker_path(path) for path in paths):
        checks.append(
            StaticCheck(
                "docker affected files",
                (python, "-m", "scripts.check_dockerfile_tracked", "--affected", *paths),
            )
        )
    if any(path == "pnpm-lock.yaml" or path.endswith("/pnpm-lock.yaml") for path in paths):
        checks.append(StaticCheck("pnpm lock", (python, "-m", "scripts.check_pnpm_lock_tracked")))
    if "uv.lock" in paths:
        checks.append(StaticCheck("uv lock", (python, "-m", "scripts.check_uv_lock")))
    python_paths = tuple(path for path in paths if path.endswith(".py"))
    if python_paths:
        checks.extend(
            (
                StaticCheck("ruff affected check", ("ruff", "check", *python_paths)),
                StaticCheck("ruff affected format", ("ruff", "format", "--check", *python_paths)),
            )
        )
    if any(path.startswith(".github/workflows/") or path == "package.json" for path in paths):
        checks.append(
            StaticCheck(
                "ci workflow contracts", (python, "-m", "scripts.check_ci_workflow_contracts")
            )
        )
    return _dedupe_checks(tuple(checks))


def run_static_checks(
    *,
    root: Path | None = None,
    affected: bool = False,
    base_ref: str = "origin/develop",
) -> int:
    base = root or repo_root()
    checks = repo_static_checks()
    if affected:
        paths = tuple(
            path.relative_to(base).as_posix()
            for path in changed_worktree_paths(root=base, base_ref=base_ref)
        )
        if not paths:
            print(f"No changed files found against {base_ref}; repo static affected lane skipped.")
            return 0
        print(f"Repo static affected lane found {len(paths)} changed files against {base_ref}.")
        checks = affected_repo_static_checks(paths)
        if not checks:
            print("No repo static checks matched the affected file set.")
            return 0
    for check in checks:
        print(f"==> {check.label}", flush=True)
        result = subprocess.run(check.command, cwd=base, check=False)
        if result.returncode != 0:
            return result.returncode
    return 0


def main(argv: tuple[str, ...] = ()) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--affected", action="store_true")
    parser.add_argument("--base", default="origin/develop")
    args = parser.parse_args(argv)
    return run_static_checks(affected=args.affected, base_ref=args.base)


def _dedupe_checks(checks: tuple[StaticCheck, ...]) -> tuple[StaticCheck, ...]:
    seen: set[tuple[str, tuple[str, ...]]] = set()
    result: list[StaticCheck] = []
    for check in checks:
        key = (check.label, check.command)
        if key in seen:
            continue
        seen.add(key)
        result.append(check)
    return tuple(result)


def _is_biome_path(path: str) -> bool:
    if path in {".markdownlint-cli2.jsonc", "biome.jsonc", "package.json", "turbo.json"}:
        return True
    return path.startswith(("apps/", "packages/", "configs/", "scripts/", "tests/"))


def _is_markdown_path(path: str) -> bool:
    return path.endswith(".md") or path in {".markdownlint-cli2.jsonc"}


def _is_lint_coverage_path(path: str) -> bool:
    return path == "scripts/check_lint_coverage_tracked.py" or path.startswith(
        ("apps/", "packages/", "configs/", "infra/", "scripts/", "tests/", "docs/")
    )


def _is_decomposition_path(path: str) -> bool:
    return path.endswith((".cjs", ".go", ".js", ".jsx", ".mjs", ".py", ".ts", ".tsx")) or path in {
        "configs/lint/decomposition-baseline.json",
        "scripts/check_decomposition_tracked.py",
    }


def _is_editorconfig_path(path: str) -> bool:
    return Path(path).name in {".editorconfig", ".gitattributes", ".gitignore"}


def _is_env_path(path: str) -> bool:
    return path.endswith((".env.example", ".local.example", ".dev.vars.example"))


def _is_sql_path(path: str) -> bool:
    return path.endswith(".sql") or path == ".sqlfluff"


def _is_docker_path(path: str) -> bool:
    name = Path(path).name
    return name.startswith("Dockerfile") or path.endswith(".dockerfile") or path == ".hadolint.yaml"


if __name__ == "__main__":
    raise SystemExit(main(tuple(sys.argv[1:])))
