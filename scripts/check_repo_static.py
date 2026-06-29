from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


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
        StaticCheck("sql tracked files", (py, "-m", "scripts.check_sql_tracked")),
        StaticCheck("docker tracked files", (py, "-m", "scripts.check_dockerfile_tracked")),
        StaticCheck("pnpm lock", (py, "-m", "scripts.check_pnpm_lock_tracked")),
        StaticCheck("uv lock", (py, "-m", "scripts.check_uv_lock")),
        StaticCheck("ruff check", ("ruff", "check", ".")),
        StaticCheck("ruff format", ("ruff", "format", ".", "--check")),
        StaticCheck("ci workflow contracts", (py, "-m", "scripts.check_ci_workflow_contracts")),
    )


def run_static_checks(*, root: Path | None = None) -> int:
    base = root or repo_root()
    for check in repo_static_checks():
        print(f"==> {check.label}", flush=True)
        result = subprocess.run(check.command, cwd=base, check=False)
        if result.returncode != 0:
            return result.returncode
    return 0


def main() -> int:
    return run_static_checks()


if __name__ == "__main__":
    raise SystemExit(main())
