# Quick Task 260411-r4m Summary

## Outcome

- 已把 Wave D local-postgres guarded release 收口为 repo-tracked quick task，而不是只散落在 `.planning/STATE.md` 和 reference 文档里。
- Wave D 当前完成事实已同步到 planning/runbook/reference/config README：
  - `closeout_run_id=local-postgres-wave-d-full-20260410-141615`
  - `preparation_run_id=prep-local-postgres-wave-d-full-20260410-141615`
  - `promotion_id=promotion-0001`
  - `release_id=r20260411_090101`
  - `physical_collection_name=internal_notice__r20260411_090101`
  - `document_count=21`
  - `point_count=213`
  - `validation_status=passed`
  - `published_at=null`
- 当前 WSL shell 对 Qdrant Cloud 的 no-proxy operator rule 已显式冻结：
  - 继承宿主机代理时，Qdrant API 会超时
  - 需要显式清空大小写代理变量，不能只做 `env -u HTTP_PROXY ...`
- Wave D 后续 repo-local 动作已明确切换为 post-release consumption / regulation-promotion follow-up，而不是重复 replay / preparation / release

## What Changed

- `.planning/STATE.md`
  - 新增 quick task `260411-r4m`
  - recent verification 增加 Qdrant inherited-proxy vs no-proxy 对照证据
  - session continuity 改为“Wave D guarded release docs closeout”
- `docs/plans/post-closeout-follow-up-execution-plan.md`
  - 补齐 Wave D guarded release 已完成后的 operator 约束
- `docs/reference/internal-notice-offline-preparation-quality-evidence.md`
  - 从“三次证据”扩成“四次证据”
  - 记录 2026-04-11 promote + unpublished release 与 Qdrant no-proxy 只读复核
- `docs/runbooks/index-release-runbook.md`
  - 新增 Qdrant Cloud proxy rule
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
  - 写明 local-postgres guarded release 已完成
  - 固定 Qdrant no-proxy operator rule
- `configs/ingestion/campus_notices/internal_notice/README.md`
  - 新增 current guarded release truth

## External Rationale

Qdrant 官方文档把 release-managed collection 的推荐姿态写得很明确：

- 先在后台构建新的 physical collection
- 再用 alias 做原子切换

参考：

- <https://qdrant.tech/documentation/concepts/collections/>
- <https://api.qdrant.tech/api-reference/aliases/update-aliases>

对当前 repo，这意味着：

- `release_registry_scope --no-publish-alias` 是正确的 guarded release 形态
- `internal_notice__r20260411_090101` 应被视为已完成但未发布的 physical release
- 在没有新的 alias publish 决策前，不应为了“再确认一次”重复生成新的 physical collection

## Boundary

- No new replay
- No new chunk preparation
- No new physical collection
- No alias publish
- No query-serving opening
