from __future__ import annotations

import json
from pathlib import Path


def required_scripts() -> dict[str, str]:
    return {
        "repo:guard": "uv run --all-packages python -m unittest tests.test_docs_structure tests.test_workspace_layout tests.test_repo_collaboration -q",
        "repo:static": "uv run --all-packages python -m scripts.check_repo_static",
        "ci:repo-guard": "pnpm repo:guard",
        "ci:repo-static": "pnpm repo:static",
        "ci:repo-static:affected": 'uv run --all-packages python -m scripts.check_repo_static --affected --base "${CI_BASE_REF:-origin/develop}"',
        "ci:contracts": "pnpm contracts:check && uv run --all-packages python -m unittest discover -s tests/contracts -t . -q",
        "ci:ingestion": "uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q",
        "ci:langfuse": (
            "pnpm --dir packages/eval-langfuse typecheck && "
            "pnpm --dir packages/eval-langfuse test && "
            "pnpm --dir apps/app-api exec tsx ./scripts/check-langfuse-trace-id-vectors.ts"
        ),
        "ci:go": "pnpm go:check",
        "ci:web-graph:affected": "turbo run typecheck test --affected --concurrency=2",
        "ci:web-graph:full": "pnpm web:check",
        "ci:worker-runtime": "pnpm web:test:worker",
        "ci:config:lint": (
            "pnpm ci:actions:lint && "
            "uv run --all-packages python -m scripts.check_ci_workflow_contracts && "
            "uv run --all-packages python -m scripts.check_workflow_action_policy"
        ),
        "ci:actions:lint": "go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7",
        "ci:secrets": "uv run --all-packages python -m scripts.run_gitleaks_scan",
        "ci:deps:vuln": "uv run --all-packages python -m scripts.run_osv_scan",
    }


def write_package(path: Path, *, pnpm_version: str = "10.26.1") -> None:
    path.write_text(
        json.dumps({"packageManager": f"pnpm@{pnpm_version}", "scripts": required_scripts()}),
        encoding="utf-8",
    )


def write_minimal_workflows(
    root: Path,
    *,
    pnpm_version: str,
    include_concurrency: bool = True,
    include_path_filters: bool = True,
    include_required_checks: bool = True,
    omit_pr_check_call: str = "",
    install_golangci_lint: bool = True,
    install_gitleaks: bool = True,
    export_secret_scan_go_bin: bool = True,
    setup_secret_scan_uv: bool = True,
    install_langfuse_dependencies: bool = True,
    setup_repo_static_uv: bool = True,
    setup_cache: bool = True,
    public_docs_schedule: bool = False,
    public_docs_deploy: bool = False,
    public_docs_dry_run_default: str = "true",
    eval_schedule: bool = False,
    include_eval_environment: bool = True,
    eval_publish_default: str = "false",
    install_osv_scanner: bool = True,
    export_osv_go_bin: bool = True,
    setup_osv_uv: bool = True,
    dining_schedule: bool = False,
    dining_unconditional_push: bool = False,
) -> None:
    (root / ".github/workflows").mkdir(parents=True, exist_ok=True)
    _write_pr_checks_workflow(
        root,
        pnpm_version=pnpm_version,
        include_concurrency=include_concurrency,
        include_path_filters=include_path_filters,
        include_required_checks=include_required_checks,
        omit_pr_check_call=omit_pr_check_call,
        install_golangci_lint=install_golangci_lint,
        install_gitleaks=install_gitleaks,
        export_secret_scan_go_bin=export_secret_scan_go_bin,
        setup_secret_scan_uv=setup_secret_scan_uv,
        install_langfuse_dependencies=install_langfuse_dependencies,
        setup_repo_static_uv=setup_repo_static_uv,
        setup_cache=setup_cache,
    )
    _write_public_docs_workflow(
        root,
        pnpm_version,
        public_docs_schedule,
        public_docs_deploy,
        public_docs_dry_run_default,
    )
    _write_eval_workflow(
        root,
        eval_schedule,
        include_eval_environment,
        eval_publish_default,
        setup_cache=setup_cache,
    )
    _write_dining_image_workflow(root, pnpm_version, dining_schedule, dining_unconditional_push)
    _write_scheduled_checks_workflow(
        root,
        pnpm_version,
        install_osv_scanner=install_osv_scanner,
        export_osv_go_bin=export_osv_go_bin,
        setup_osv_uv=setup_osv_uv,
        setup_cache=setup_cache,
    )


def _write_pr_checks_workflow(
    root: Path,
    *,
    pnpm_version: str,
    include_concurrency: bool,
    include_path_filters: bool,
    include_required_checks: bool,
    omit_pr_check_call: str,
    install_golangci_lint: bool,
    install_gitleaks: bool,
    export_secret_scan_go_bin: bool,
    setup_secret_scan_uv: bool,
    install_langfuse_dependencies: bool,
    setup_repo_static_uv: bool,
    setup_cache: bool,
) -> None:
    pr_check_calls = tuple(
        call
        for call in (
            "pnpm ci:repo-guard",
            "pnpm ci:repo-static",
            "pnpm ci:repo-static:affected",
            "pnpm ci:config:lint",
            "pnpm ci:secrets",
            "pnpm ci:web-graph:affected",
            "pnpm ci:worker-runtime",
            "pnpm ci:contracts",
            "pnpm ci:langfuse",
            "pnpm ci:go",
            "pnpm ci:ingestion",
        )
        if call != omit_pr_check_call
    )
    (root / ".github/workflows/pr-checks.yml").write_text(
        "\n".join(
            (
                "name: pr-checks",
                "on:",
                "  pull_request:",
                *_concurrency_lines(include_concurrency),
                "jobs:",
                *_changes_job(include_path_filters),
                *_simple_job("repo-guard", "pnpm ci:repo-guard"),
                *_repo_static_job(pnpm_version, setup_repo_static_uv, setup_cache, pr_check_calls),
                *_simple_job("config-lint", "pnpm ci:config:lint"),
                *_path_filtered_jobs(
                    pnpm_version, install_golangci_lint, install_langfuse_dependencies
                ),
                *_secret_scan_job(
                    install_gitleaks, export_secret_scan_go_bin, setup_secret_scan_uv
                ),
                *_required_checks_job(include_required_checks),
                "",
            )
        ),
        encoding="utf-8",
    )


def _simple_job(name: str, command: str) -> tuple[str, ...]:
    return (
        f"  {name}:",
        "    steps:",
        f"      - run: {command}",
    )


def _repo_static_job(
    pnpm_version: str,
    setup_repo_static_uv: bool,
    setup_cache: bool,
    pr_check_calls: tuple[str, ...],
) -> tuple[str, ...]:
    repo_static_uv_steps = (
        ("      - uses: astral-sh/setup-uv@v6", *_uv_cache_lines(setup_cache))
        if setup_repo_static_uv
        else ()
    )
    return (
        "  repo-static:",
        "    needs: changes",
        "    env:",
        "      CI_BASE_REF: ${{ needs.changes.outputs.base_sha }}",
        "    steps:",
        *repo_static_uv_steps,
        "      - uses: pnpm/action-setup@v4",
        "        with:",
        f"          version: {pnpm_version}",
        "      - uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "24"',
        *_node_cache_lines(setup_cache),
        "      - run: pnpm install --frozen-lockfile",
        "      - run: uv sync --all-packages --dev",
        *(f"      - run: {call}" for call in pr_check_calls),
    )


def _path_filtered_jobs(
    pnpm_version: str,
    install_golangci_lint: bool,
    install_langfuse_dependencies: bool,
) -> tuple[str, ...]:
    go_install_steps = (
        ("      - run: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.4",)
        if install_golangci_lint
        else ()
    )
    langfuse_install_steps = (
        ("      - run: pnpm install --frozen-lockfile",) if install_langfuse_dependencies else ()
    )
    return (
        "  web-graph:",
        "    needs: changes",
        "    if: needs.changes.outputs.web_graph == 'true'",
        "    env:",
        "      TURBO_SCM_BASE: ${{ needs.changes.outputs.base_sha }}",
        "    steps:",
        "      - uses: pnpm/action-setup@v4",
        "        with:",
        f"          version: {pnpm_version}",
        "      - run: pnpm ci:web-graph:affected",
        "  worker-runtime:",
        "    needs: changes",
        "    if: needs.changes.outputs.worker_runtime == 'true'",
        "    steps:",
        "      - run: pnpm ci:worker-runtime",
        "  contracts:",
        "    needs: changes",
        "    if: needs.changes.outputs.contracts == 'true'",
        "    steps:",
        "      - run: pnpm ci:contracts",
        "  execution-control-go:",
        "    needs: changes",
        "    if: needs.changes.outputs.go == 'true'",
        "    steps:",
        "      - uses: pnpm/action-setup@v4",
        "        with:",
        f"          version: {pnpm_version}",
        *go_install_steps,
        "      - run: pnpm ci:go",
        "  langfuse-integration:",
        "    needs: changes",
        "    if: needs.changes.outputs.langfuse == 'true'",
        "    steps:",
        "      - uses: pnpm/action-setup@v4",
        "        with:",
        f"          version: {pnpm_version}",
        *langfuse_install_steps,
        *(
            (
                "      - uses: actions/setup-node@v4",
                "        with:",
                '          node-version: "24"',
                "          cache: pnpm",
                "          cache-dependency-path: pnpm-lock.yaml",
            )
            if install_langfuse_dependencies
            else ()
        ),
        "      - run: pnpm ci:langfuse",
        "  ingestion:",
        "    needs: changes",
        "    if: needs.changes.outputs.ingestion == 'true'",
        "    steps:",
        "      - run: pnpm ci:ingestion",
    )


def _changes_job(enabled: bool) -> tuple[str, ...]:
    if not enabled:
        return ()
    outputs = tuple(
        f"      {name}: ${{{{ steps.filter.outputs.{name} }}}}"
        for name in (
            "base_sha",
            "contracts",
            "go",
            "ingestion",
            "langfuse",
            "web_graph",
            "worker_runtime",
        )
    )
    return (
        "  changes:",
        "    outputs:",
        *outputs,
        "    steps:",
        "      - id: filter",
        "        run: |",
        '          echo base_sha=HEAD~1 >> "$GITHUB_OUTPUT"',
        '          echo contracts=true >> "$GITHUB_OUTPUT"',
        '          echo go=true >> "$GITHUB_OUTPUT"',
        '          echo ingestion=true >> "$GITHUB_OUTPUT"',
        '          echo langfuse=true >> "$GITHUB_OUTPUT"',
        '          echo web_graph=true >> "$GITHUB_OUTPUT"',
        '          echo worker_runtime=true >> "$GITHUB_OUTPUT"',
    )


def _required_checks_job(enabled: bool) -> tuple[str, ...]:
    if not enabled:
        return ()
    return (
        "  required-checks:",
        "    needs:",
        "      - changes",
        "      - repo-guard",
        "      - repo-static",
        "      - config-lint",
        "      - secret-scan",
        "      - web-graph",
        "      - worker-runtime",
        "      - contracts",
        "      - execution-control-go",
        "      - langfuse-integration",
        "      - ingestion",
        "    if: always()",
        "    steps:",
        "      - run: echo success|skipped",
    )


def _secret_scan_job(
    install_gitleaks: bool,
    export_go_bin: bool,
    setup_uv: bool,
) -> tuple[str, ...]:
    uv_steps = (
        (
            "      - uses: astral-sh/setup-uv@v6",
            "        with:",
            "          enable-cache: true",
        )
        if setup_uv
        else ()
    )
    install_steps = (
        (
            "      - run: |",
            "          go install github.com/zricethezav/gitleaks/v8@v8.30.1",
            *(
                ('          echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',)
                if export_go_bin
                else ()
            ),
        )
        if install_gitleaks
        else ()
    )
    return (
        "  secret-scan:",
        "    steps:",
        *uv_steps,
        "      - uses: actions/setup-go@v5",
        "        with:",
        '          go-version: "1.26.2"',
        *install_steps,
        "      - run: pnpm ci:secrets",
    )


def _write_public_docs_workflow(
    root: Path, pnpm_version: str, scheduled: bool, deploy: bool, dry_run_default: str
) -> None:
    triggers = (
        (
            "on:",
            "  schedule:",
            "    - cron: '7 4,10,16,22 * * *'",
            "  workflow_dispatch:",
            "    inputs:",
            "      dry_run:",
            f"        default: {dry_run_default}",
        )
        if scheduled
        else (
            "on:",
            "  workflow_dispatch:",
            "    inputs:",
            "      dry_run:",
            f"        default: {dry_run_default}",
        )
    )
    command = "pnpm --dir apps/campus-web deploy" if deploy else "pnpm --dir apps/campus-web build"
    (root / ".github/workflows/public-docs-rolling-publish.yml").write_text(
        "\n".join(
            (
                "name: public-docs-rolling-publish",
                *triggers,
                "jobs:",
                "  publish:",
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - run: |",
                '          if [ "${{ inputs.dry_run }}" != "true" ]; then',
                "            exit 1",
                "          fi",
                f"      - run: {command}",
                "",
            )
        ),
        encoding="utf-8",
    )


def _write_eval_workflow(
    root: Path,
    scheduled: bool,
    include_environment: bool,
    publish_default: str,
    *,
    setup_cache: bool,
) -> None:
    triggers = (
        (
            "on:",
            "  schedule:",
            "    - cron: '9 4 * * *'",
            "  workflow_dispatch:",
            "    inputs:",
            "      publish_langfuse_scores:",
            f"        default: {publish_default}",
        )
        if scheduled
        else (
            "on:",
            "  workflow_dispatch:",
            "    inputs:",
            "      publish_langfuse_scores:",
            f"        default: {publish_default}",
        )
    )
    environment = ("    environment: eval-internal",) if include_environment else ()
    (root / ".github/workflows/eval-ragas-score.yml").write_text(
        "\n".join(
            (
                "name: eval-ragas-score",
                *triggers,
                "jobs:",
                "  eval-ragas-score:",
                *environment,
                "    env:",
                "      LLM_API_KEY: ${{ secrets.LLM_API_KEY }}",
                "    steps:",
                "      - uses: actions/setup-python@v5",
                "      - uses: astral-sh/setup-uv@v6",
                *_uv_cache_lines(setup_cache),
                "      - run: uv sync --all-packages --dev",
                "      - run: args+=(--validate-only)",
                "      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-traces",
                "      - run: pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset",
                "",
            )
        ),
        encoding="utf-8",
    )


def _write_dining_image_workflow(
    root: Path, pnpm_version: str, scheduled: bool, unconditional_push: bool
) -> None:
    triggers = (
        (
            "on:",
            "  schedule:",
            "    - cron: '11 4 * * *'",
            "  workflow_dispatch:",
            "    inputs:",
            "      push_image:",
            "        default: false",
        )
        if scheduled
        else (
            "on:",
            "  workflow_dispatch:",
            "    inputs:",
            "      push_image:",
            "        default: false",
        )
    )
    guard = "true" if unconditional_push else "${{ inputs.push_image }}"
    (root / ".github/workflows/dining-sync-image.yml").write_text(
        "\n".join(
            (
                "name: dining-sync-image",
                *triggers,
                "permissions:",
                "  contents: read",
                "  packages: write",
                "jobs:",
                "  build:",
                "    steps:",
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - uses: docker/build-push-action@v6",
                "        with:",
                "          load: true",
                "          push: false",
                "      - uses: aquasecurity/trivy-action@v0.36.0",
                "        with:",
                '          exit-code: "1"',
                "          severity: HIGH,CRITICAL",
                "      - uses: anchore/sbom-action@v0.24.0",
                f"        if: {guard}",
                "        with:",
                "          dependency-snapshot: false",
                "      - uses: docker/login-action@v3",
                f"        if: {guard}",
                "      - uses: docker/build-push-action@v6",
                f"        if: {guard}",
                "        with:",
                "          push: true",
                "",
            )
        ),
        encoding="utf-8",
    )


def _write_scheduled_checks_workflow(
    root: Path,
    pnpm_version: str,
    *,
    install_osv_scanner: bool,
    export_osv_go_bin: bool,
    setup_osv_uv: bool,
    setup_cache: bool,
) -> None:
    uv_steps = (
        (
            "      - uses: astral-sh/setup-uv@v6",
            "        with:",
            "          enable-cache: true",
        )
        if setup_osv_uv
        else ()
    )
    install_steps = (
        (
            "      - run: |",
            "          go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.3.8",
            *(
                ('          echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',)
                if export_osv_go_bin
                else ()
            ),
        )
        if install_osv_scanner
        else ()
    )
    (root / ".github/workflows/scheduled-checks.yml").write_text(
        "\n".join(
            (
                "name: scheduled-checks",
                "on:",
                "  schedule:",
                "    - cron: '23 2 * * *'",
                "jobs:",
                "  dependency-vulnerability-full:",
                "    steps:",
                *uv_steps,
                "      - uses: actions/setup-go@v5",
                "        with:",
                '          go-version: "1.26.2"',
                *install_steps,
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                f"          version: {pnpm_version}",
                "      - uses: actions/setup-node@v4",
                "        with:",
                '          node-version: "24"',
                *_node_cache_lines(setup_cache),
                "      - run: pnpm ci:deps:vuln",
                "",
            )
        ),
        encoding="utf-8",
    )


def _concurrency_lines(enabled: bool) -> tuple[str, ...]:
    if not enabled:
        return ()
    return (
        "concurrency:",
        "  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
        "  cancel-in-progress: true",
    )


def _uv_cache_lines(enabled: bool) -> tuple[str, ...]:
    return ("        with:", "          enable-cache: true") if enabled else ()


def _node_cache_lines(enabled: bool) -> tuple[str, ...]:
    return (
        ("          cache: pnpm", "          cache-dependency-path: pnpm-lock.yaml")
        if enabled
        else ()
    )
