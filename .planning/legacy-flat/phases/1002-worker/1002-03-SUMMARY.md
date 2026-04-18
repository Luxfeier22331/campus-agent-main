# 1002-03 Summary: release-scoped post-deploy evidence contract 已冻结

## Outcome

`1002-03` 已完成。staging 发布后的 smoke / observability 闭环现在不再以“deploy 成功”或 `/readyz = 200` 作为完成定义，而是以 release-scoped trace / runtime event artifact 作为 closeout 口径。

## Key Changes

- `docs/architecture/runtime-delivery-and-release-hardening-architecture.md`
  - 冻结长期发布闭环：`config truth -> preflight -> deploy-time release identity -> post-deploy smoke -> observability evidence artifact`
- `docs/runbooks/staging-worker-deploy-runbook.md`
  - staging deploy runbook 现已把 canonical preflight 与 post-deploy evidence 并列为 closure 条件
- `docs/runbooks/worker-observability-smoke-runbook.md`
  - 固定 evidence artifact 目录、最小文件集合、trace/runtime-event 要求与 release identity 绑定关系
- `docs/environment/README.md`
  - staging baseline、release identity 与 preflight truth 已同步到环境文档

## Verification

- architecture/runbook review against `docs/architecture/runtime-delivery-and-release-hardening-architecture.md`
- runbook review against `docs/runbooks/staging-worker-deploy-runbook.md`
- artifact contract review against `docs/runbooks/worker-observability-smoke-runbook.md`

结果：

- 当前 repo 级 closeout 已不再把 `/readyz = 200` 或单次 deploy success 误记成 release closure

## Remaining Gap

- 真实 `chat trace` / `panel trace` / `app-api runtime event` 证据仍要等首个 staging 发布窗口执行
- 因此当前正确状态是 `repo-level contract closed`，不是 `real staging evidence completed`

## Next

- 当 staging 发布窗口可用时，按新的 artifact contract 执行一次真实 deploy closeout
