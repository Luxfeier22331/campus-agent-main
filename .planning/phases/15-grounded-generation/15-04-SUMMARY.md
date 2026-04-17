# 15-04 Summary: focused verification 与 blocker-aware phase closeout

## Outcome

Wave D 已完成 Phase 15 的 repo-local closeout。

本 wave 证明了两件事：

- Phase 15 的本地代码、contract、eval、app-api/operator observability 已形成可重复 gate
- live artifact refresh 仍受 supplemental provider `/responses` regression 阻断，因此它被明确记录为 external blocker，而不是未完成代码项

这意味着：

- Phase 15 可以在 repo-local 维度上关闭
- historical curriculum `warn` artifact replacement 继续 deferred，等待 external provider 恢复 accepted contract

## Key Changes

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
  - 新增 Phase 15 repo-local closeout 状态
  - 冻结最终 local gate set
- `docs/plans/prompt-grounding-and-hallucination-hardening-plan.md`
  - 明确本文已退出 active lane
  - 记录 repo-local closeout 与 deferred live artifact blocker 的分界
- `.planning/phases/15-grounded-generation/15-RESEARCH.md`
  - 增加 closeout implication，明确为何 repo-local closeout 与 live artifact refresh 应拆开记录
- `.planning/ROADMAP.md`
  - 将 Phase 15 标记为 completed
  - 记录 completion note：repo-local closeout complete，live artifact refresh deferred on external blocker
- `.planning/STATE.md`
  - 更新当前状态、recent verification、session continuity 与 remaining blocker wording

## Verification

Fresh Wave D verification:

```bash
uv run --all-packages --no-sync python -m unittest \
  tests.contracts.test_models \
  tests.specialist.test_rag_specialist \
  tests.evals.test_golden_cases \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark

pnpm --dir apps/app-api exec vitest run \
  test/request-observability.test.ts \
  test/operator-query.route.test.ts
```

Result:

- Python focused Phase 15 gate: `Ran 219 tests` / `OK`
- app-api focused observability gate: `20 passed`

Supplemental closeout evidence retained from Wave C:

```bash
pnpm --dir apps/app-api exec vitest run \
  test/request-diagnostics.test.ts \
  test/request-observability.test.ts \
  test/operator-query.route.test.ts \
  test/operator-query.service.test.ts \
  test/supervisor-adapter.test.ts

pnpm --dir apps/app-api exec vitest run test/projection.service.test.ts
pnpm --dir apps/app-api exec tsc -p tsconfig.json --noEmit
```

## Remaining Blocker

- supplemental eval provider `https://www.su8.codes/codex/v1` 仍存在 `/responses` regression
- 当前观测到的 blocker 形态是：`status='completed'` 但 `output=[]`
- 在该 blocker 清除前，不得宣称已完成新的 live prompt-family artifact refresh

## Next

- grounded-generation 主题不再有 active repo-local implementation lane
- 等 external provider 恢复 accepted `/responses` contract 后，再单独重跑 historical curriculum `warn` live artifact replacement
