from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SURFACE_NAMES = (
    "contracts",
    "go",
    "ingestion",
    "langfuse",
    "web_graph",
    "worker_runtime",
)


def classify_changed_surfaces(paths: tuple[str, ...]) -> dict[str, bool]:
    surfaces = dict.fromkeys(SURFACE_NAMES, False)
    for path in paths:
        normalized = path.strip()
        if not normalized:
            continue
        if _is_global_ci_path(normalized):
            return dict.fromkeys(SURFACE_NAMES, True)
        if _is_web_graph_path(normalized):
            surfaces["web_graph"] = True
        if _is_worker_runtime_path(normalized):
            surfaces["worker_runtime"] = True
        if _is_contracts_path(normalized):
            surfaces["contracts"] = True
        if _is_go_path(normalized):
            surfaces["go"] = True
        if _is_langfuse_path(normalized):
            surfaces["langfuse"] = True
        if _is_ingestion_path(normalized):
            surfaces["ingestion"] = True
    return surfaces


def changed_paths(*, base: str, head: str, root: Path | None = None) -> tuple[str, ...]:
    repo_root = root or Path(__file__).resolve().parents[1]
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "diff", "--name-only", base, head],
        check=True,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    return tuple(line.strip() for line in result.stdout.splitlines() if line.strip())


def write_github_output(surfaces: dict[str, bool], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as output:
        for name in SURFACE_NAMES:
            output.write(f"{name}={'true' if surfaces[name] else 'false'}\n")


def main(argv: tuple[str, ...] = ()) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args(argv)

    surfaces = classify_changed_surfaces(changed_paths(base=args.base, head=args.head))
    if args.github_output:
        write_github_output(surfaces, args.github_output)
    else:
        for name in SURFACE_NAMES:
            print(f"{name}={'true' if surfaces[name] else 'false'}")
    return 0


def _is_global_ci_path(path: str) -> bool:
    return path in {
        ".github/workflows/pr-checks.yml",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
    } or path in {
        "scripts/detect_ci_changed_surfaces.py",
        "scripts/check_ci_workflow_contracts.py",
        "scripts/ci_workflow_contract_types.py",
        "scripts/check_workflow_action_policy.py",
        "scripts/check_package_script_policy.py",
    }


def _is_web_graph_path(path: str) -> bool:
    return path.startswith(("apps/", "jobs/", "packages/")) and path.endswith(
        (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".mts", ".cts")
    )


def _is_worker_runtime_path(path: str) -> bool:
    return path.startswith(
        (
            "apps/app-api/",
            "apps/campus-web/",
            "apps/operator-console-web/",
            "configs/runtime/",
        )
    )


def _is_contracts_path(path: str) -> bool:
    return path.startswith(("packages/contracts/", "tests/contracts/", "configs/runtime/"))


def _is_go_path(path: str) -> bool:
    return path.startswith(("apps/execution-control/", "configs/runtime/"))


def _is_langfuse_path(path: str) -> bool:
    return path.startswith(
        (
            "packages/eval-langfuse/",
            "packages/ragas-runner/",
            "docs/architecture/system/langfuse.md",
            "docs/contracts/langfuse-runtime.md",
            "docs/decisions/adr-0061-eval-runtime.md",
            "docs/decisions/adr-0062-ragas-langfuse.md",
            "docs/product/langfuse-evals.md",
            "docs/reference/eval.md",
            "docs/reference/eval-map.md",
            "docs/runbooks/eval-ragas.md",
            "tests/fixtures/langfuse_trace_id_vectors.json",
            "apps/app-api/src/modules/telemetry/",
            "apps/app-api/scripts/check-langfuse-trace-id-vectors.ts",
        )
    )


def _is_ingestion_path(path: str) -> bool:
    return path.startswith(
        (
            "apps/ingestion-control/",
            "apps/ingestion-worker/",
            "apps/authenticated-notice-collector/",
            "apps/official-web-collector/",
            "apps/wechat-official-account-collector/",
            "packages/ingestion-core/",
            "packages/ingestion-contracts/",
            "packages/ingestion-kernels-rs/",
            "tests/ingestion/",
        )
    )


if __name__ == "__main__":
    raise SystemExit(main(tuple(sys.argv[1:])))
