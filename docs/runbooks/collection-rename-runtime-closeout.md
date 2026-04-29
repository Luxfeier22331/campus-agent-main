---
doc_type: runbook
status: active
created: 2026-04-22
updated: 2026-04-23
---
# Collection Rename Runtime Closeout

## 文档边界

这份 runbook 只负责 repo 已完成 collection rename 之后的运行时收口：

- object store release family / Qdrant alias family 的只读核对
- local PG 当前消费面的旧 collection 名回填
- ingestion-owned registry 旧 collection 名回填
- request projection 的按需 replay

它不负责：

- 历史 planning / archive 材料清理
- 旧 release artifact 或旧 physical collection 删除
- 新的 serving scope 设计讨论

## 适用 rename map

当前只接受两组 rename：

- `regulations/student_handbook -> regulations/student_rules`
- `regulations/institutional_regulations -> regulations/institutional_rules`

不引入长期 compatibility alias layer。

## 1. 运行时 audit

先核对 object store release family 和 Qdrant alias / physical collection family：

```bash
uv run --package campus-ingestion-worker \
  campus-ingestion-audit-collection-runtime-state
```

输出会按 target 给出：

- legacy release manifest family
- canonical release manifest family
- legacy Qdrant alias / physical collection family
- canonical Qdrant alias / physical collection family

固定规则：

- 旧 family 可以作为历史产物保留
- 当前 runtime-facing alias 必须只以 canonical family 为准
- 这一步不删除任何 object store key 或 physical collection

## 2. PG audit

先核对 local PG 当前消费面还有多少旧名：

```bash
pnpm --dir apps/app-api collection-rename:audit
```

这一步只检查当前 app/operator 会消费的几张表：

- `runtime.request_execution`
- `runtime.request_observability_fact`
- `operator.request_projection`
- `operator.metric_rollup`
- `operator.quality_grade_projection`

## 3. PG apply

确认 audit 后执行回填：

```bash
pnpm --dir apps/app-api collection-rename:apply -- --write-report \
  .tmp/collection-rename-apply.json
```

行为：

- 只改 resolved-side/runtime truth
- `requested_scope_json` / `requested_scope_summary` 保持原样
- 当前消费面的 operator projection / rollup 会直接改成 canonical collection 名
- 输出 affected request id 列表，供后续 replay 使用

## 4. 按需 replay request projection

如果需要从 `runtime.*` 重新跑一次 request projection，可使用 apply report：

```bash
pnpm --dir apps/app-api collection-rename:replay -- --report \
  .tmp/collection-rename-apply.json
```

也可以直接指定 request id：

```bash
pnpm --dir apps/app-api collection-rename:replay -- --request-id req_01 \
  --request-id req_02
```

固定规则：

- 优先复用已有 `runtime.projection_outbox` event id
- 只有缺少可复用 outbox event 时，才补 synthetic replay event

## 5. Ingestion Registry Audit / Apply

在做 canonical release cutover 前，先核对并修正 ingestion-owned registry 里的旧 collection 名。

先 audit：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.collection_rename_registry_backfill audit
```

确认后 apply：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.collection_rename_registry_backfill apply
```

固定规则：

- 同时检查 `document_registry` 与 `raw_asset_registry`
- 同时修正标量 `collection` 列与 `record.collection`
- 这是 `student_rules` replay release 的前置条件；否则本地 replay 可能会因为 legacy scope row 直接
  fail-close

## 6. student_rules release closeout

### `student_rules`

继续使用既有 replay release shell：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_rules \
  --raw-version-id <raw_version_id> \
  --source-pdf <source_pdf> \
  --no-publish-alias
```

验证通过后再：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_rules \
  --raw-version-id <raw_version_id> \
  --source-pdf <source_pdf> \
  --publish-alias
```

补充约束：

- handbook replay 会 fail-close 消费 repo-tracked downstream projection；如果缺少
  `projection/handbook_navigation_service_catalog/flow-graph.json`，先补齐 source
  projection artifact， 再继续 `student_rules` release
- `scoped_rules` 继续保持 `query_enabled=false`

## 7. `institutional_rules`

当前不把 `institutional_rules` 纳入这轮 rename release cutover。

固定规则：

- `institutional_rules` 继续保持 `offline_preparation`
- 只有在 dedicated target materialization / chunk-prep / validation truth 准备完成后，
  才进入独立的 registry-scope release 流程
- `institutional_rules` 进入 release-managed lifecycle 不等于打开 query serving

## 完成标准

- app/operator 当前消费面不再残留旧 collection 名
- ingestion-owned registry 当前消费面不再残留旧 collection 名
- canonical alias family 已指向新 family physical collection
- 历史 materials 可以继续保留，但不再冒充当前 runtime truth
