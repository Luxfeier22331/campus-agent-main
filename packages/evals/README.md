# campus-evals

Evaluation helpers and repo-tracked fixtures for campus-agent v2.

`packages/evals` owns deterministic eval fixtures, fixture registry access,
eval CLIs and sanitized artifact validators. It does not own product/runtime
truth, domain source truth or release closeout procedure.

## Fixture Registry

Fixture access starts from:

- `fixtures/registry.v1.json`
- `campus_evals.fixture_registry.fixture_path(...)`

New eval datasets must register a logical fixture id before a loader consumes
the file. Loaders must not hand-code fixture directory layout.

Production runtime schema does not live in eval fixtures. Model-visible tool
argument schema lives in `configs/runtime/tool-function-schemas.v1.json`.

## Current Eval Families

Active fixture families include:

- RAG retrieval qrels and live-gate samples
- golden workflow/status cases
- online answer path and workflow trace cases
- tool denominator and tool runtime contract cases
- answer-quality, document-quality, authz/privacy and agentic-retrieval plan
  cases
- eval operations profile policy and denominator registry

Family-level truth and denominator policy live in:

- `docs/reference/eval-gold-truth-model.md`
- `docs/reference/golden-dataset-case-matrix.md`
- `docs/reference/student-handbook-eval-metrics.md`
- `docs/reference/curriculum-plan-eval-metrics.md`
- `docs/runbooks/eval-operations-governance.md`
- `docs/runbooks/eval-release-gate-automation.md`

## Commands

```bash
uv run --all-packages python -m unittest tests.evals.test_retrieval_benchmark
uv run --all-packages python -m unittest tests.evals.test_golden_cases
uv run --all-packages python -m scripts.eval_gate audit --json
uv run --all-packages python -m scripts.eval_gate accept \
  --profile tool-runtime-contract --json
```

Run profile-specific commands from the owning runbook. Do not promote one-off
`.tmp` artifacts, runtime workaround notes or raw production observations into
canonical fixture truth without the candidate review workflow.

## Governance

- Deterministic gates own canonical pass/fail truth.
- Supplemental judges such as RAGAS or provider graders are adapters after
  deterministic truth, not replacements for it.
- Observed production cases enter `pending_review` first and become regression
  fixtures only after eval-owner review.
- Eval artifacts must not store raw transcript, raw prompt, provider raw
  response, auth material, Hindsight raw payload or unrestricted private data.
