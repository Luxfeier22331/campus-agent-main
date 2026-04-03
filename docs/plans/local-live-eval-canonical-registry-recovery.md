---
doc_type: plan
status: active
created: 2026-04-03
updated: 2026-04-03
---

# Local Live Eval Canonical Registry Recovery

## 文档边界

本文只负责 repo-local `curriculum_plan` 与 `student_handbook` live accept 的恢复方案。

本文不负责：

- 重新定义长期 identity / authorization architecture
- 为 runtime query path 重新引入 `acl_groups`、`campus_scope`、`acl_level` 兼容
- 把本地 eval ingress 参数误记成远端 deploy secret
- 替代 release-managed rebuild / alias publish runbook

对应 source of truth：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0016-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/legacy-acl-carrier-compatibility-sunset.md`
- `docs/runbooks/index-release-runbook.md`
- `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`
- `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md`

## 触发背景

2026-04-03 的两轮 repo-local live accept 都已经跑完，但它们当前不能被当成有效质量结论：

- `.tmp/evals/curriculum-plan-live-gate-accept-20260403T220918`
- `.tmp/evals/student-handbook-formal-benchmark-accept-20260403T222115`

这两轮 run 暴露了两个串行问题：

1. 本地 `supervisor-api` 最初仍按 `bearer + 8080` 启动，而 `app-api` eval bridge 需要的是 `trusted-worker + 8081`。
2. 把本地 auth 模式纠正后，`supervisor-api` 在真实 retrieval 路径上继续崩溃，根因是 document registry 当前行仍残留 legacy authz payload：
   `registry payload contains unsupported authorization projection keys: acl_groups, campus_scope`

因此当前失败不是“评测框架坏掉了”，也不是“模型质量直接退化了”，而是本地 data plane 与 canonical runtime query path 不一致。

## 2026-04-03 执行进展

本轮已确认并修复两个更深一层的离线阻塞点：

1. `local_rebuild.rebuild_local_data()` 在删除旧 derived artifacts 之前，会先枚举 scope 下的 registry rows 收集 `processed_object_keys`；legacy rows 会在 `_document_record_from_dict()` 处提前抛错。
2. `campusrag_ingestion_support.collect_import_document_stats()` 在真正写入新 import 结果前，也会先 `list_by_scope()` 预取 existing records；如果 scope 内仍有 legacy payload，provider replay rebuild 依旧会在导入阶段失败。

已落地的 repo 修复保持了 runtime canonical-only fail-fast，不把 legacy 兼容重新带回 query path：

- `registry` 新增离线辅助读取：
  - `list_processed_object_keys_by_scope`：直接从原始 payload 提取 `processed_object_keys`
  - `list_importable_scope_records_by_scope`：逐行跳过 legacy authz payload，只返回仍可作为导入对比基线的 canonical rows
- `local_rebuild` 现在优先使用原始 `processed_object_keys` 入口做 rebuild 前清理，不再要求 scope rows 先能完整反序列化
- `collect_import_document_stats` 现在优先使用 importable prefetch；若是 `scope_refresh` 主 scope 且 registry 只剩 legacy rows，也允许按空旧 scope 继续 full-scope replace

本轮已通过的回归验证：

- `uv run --all-packages python -m unittest tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.ingestion.test_registry_models`

当前操作状态：

- `student_handbook` preview rebuild 已不再在 `unsupported authorization projection keys` 处秒退
- 它会继续进入 object store / Qdrant 外部 I/O 阶段；由于这轮执行中超过 5 分钟仍未收口，已手动停止，避免在 worktree 留下无限后台任务
- 因此 Wave 2 的“legacy parser fail-fast”阻塞已解除，但 preview rebuild / alias publish / live accept 仍未完成

## 目标

恢复一条有效的 repo-local live accept 路径，使 handbook / curriculum 的 accept 结果重新可用于产品判断。

本轮完成时，至少满足：

1. repo-local `app-api -> supervisor-api` live eval 路径以 `trusted-worker` 模式稳定联通。
2. `curriculum_plan` 与 `student_handbook` 的 current serving registry rows 不再含 `acl_groups` / `campus_scope` / `acl_level`。
3. release-managed rebuild 重新生成 canonical authz projection 的 registry / chunk / index truth。
4. handbook / curriculum representative smoke 不再返回 `internal_error` 或 `supervisor_unavailable`。
5. 新的一轮 live accept 不再被 runtime crash 污染，才允许重新讨论 deterministic / supplemental gate 的产品结论。

## 不可退让约束

1. 不允许为了让本地 accept 通过，重新把 runtime query path 改回读取 legacy ACL carrier。
2. legacy 兼容只允许留在离线 rebuild / migration 入口；不允许重新进入 `supervisor-api`、`retrieval-core`、`rag-specialist` 的产品路径。
3. alias publish 之前必须先做 preview rebuild；不允许直接手改 alias 指针跳过验证。
4. 若 preview rebuild 后 current rows 仍含 legacy key，应先停下查 data-plane truth，不允许直接继续跑 accept。

## 执行顺序

### Wave 0：本地 runtime 启动方式纠正

目标：

- 确保本地 eval ingress 使用的不是错误的 `bearer` 本地默认值

动作：

- root `.env` 保持本地 eval ingress 参数：
  - `APP_API_BASE_URL=http://127.0.0.1:8787`
  - `APP_API_INTERNAL_SHARED_SECRET=<same as apps/app-api/.dev.vars>`
  - `APP_API_EVAL_USER_EMAIL=<local eval user>`
- 本地 `supervisor-api` 必须按下面方式启动，而不是直接吃 root `.env` 默认 `bearer`：

```bash
set -a && source apps/app-api/.dev.vars && set +a && \
API_AUTH_MODE=trusted-worker \
API_WORKER_SHARED_SECRET="$SUPERVISOR_API_SHARED_SECRET" \
CAMPUS_AGENT_HTTP_HOST=127.0.0.1 \
CAMPUS_AGENT_HTTP_PORT=8081 \
uv run --all-packages campus-supervisor-api-dev
```

- `app-api` 保持：

```bash
pnpm --dir apps/app-api dev -- --ip 127.0.0.1 --port 8787
```

完成定义：

- `app-api` 不再因为 bridge auth mismatch 返回顶层 `internal_error`
- 本地 supervisor bridge 语义与 Worker runtime seam 一致

### Wave 1：冻结当前脏数据范围

目标：

- 在重建前确认用于 replay 的 `raw_version_id`，并确认 legacy payload 仍落在哪些 current rows

动作：

- 查询 raw asset registry，锁定本轮 handbook / curriculum 的 `raw_version_id`
- 查询 document registry current rows，确认 legacy authz key 只作为待修复数据问题被记录，而不是继续被 runtime 消费

推荐检查：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python - <<'PY'
import os, psycopg

raw_dsn = os.environ["RAW_ASSET_REGISTRY_DATABASE_URL"]
doc_dsn = os.environ["DOCUMENT_REGISTRY_DATABASE_URL"]

with psycopg.connect(raw_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection,
                   record->>'raw_asset_id' as raw_asset_id,
                   record->>'raw_version_id' as raw_version_id,
                   record->>'ingestion_timestamp' as ingestion_timestamp
            from ingestion_registry.raw_asset_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
            order by corpus, collection, ingestion_timestamp desc
            """
        )
        print(cur.fetchall())

with psycopg.connect(doc_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection, count(*)
            from ingestion_registry.document_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
              and (record->>'is_current')::boolean = true
              and (
                (record ? 'acl_groups')
                or (record ? 'campus_scope')
                or (record ? 'acl_level')
              )
            group by corpus, collection
            order by corpus, collection
            """
        )
        print(cur.fetchall())
PY
```

完成定义：

- 两个 collection 的 rebuild 输入已锁定
- 当前 serving rows 的 legacy payload 污染范围可重复确认

### Wave 2：preview canonical rebuild，不切 alias

目标：

- 先生成新的 canonical rebuild 结果，不直接影响 serving alias

动作：

- handbook 与 curriculum 都走 release-managed replay rebuild
- 都带 `--reset-index`
- 都先使用 `--no-publish-alias`

命令模板：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <curriculum_raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --reset-index \
  --no-publish-alias
```

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_handbook \
  --raw-version-id <handbook_raw_version_id> \
  --source-pdf 学生手册_2018.pdf \
  --reset-index \
  --no-publish-alias
```

preview 后必须复查：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python - <<'PY'
import os, psycopg

doc_dsn = os.environ["DOCUMENT_REGISTRY_DATABASE_URL"]
with psycopg.connect(doc_dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            select corpus, collection, count(*)
            from ingestion_registry.document_registry_records
            where (corpus, collection) in (
              ('curriculum', 'curriculum_plan'),
              ('regulations', 'student_handbook')
            )
              and (record->>'is_current')::boolean = true
              and (
                (record ? 'acl_groups')
                or (record ? 'campus_scope')
                or (record ? 'acl_level')
              )
            group by corpus, collection
            order by corpus, collection
            """
        )
        print(cur.fetchall())
PY
```

完成定义：

- current serving rows 已切回 canonical-only authz projection
- 若仍残留 legacy current rows，本轮停止，不继续 alias publish

### Wave 3：publish alias，并做最小 smoke

目标：

- 在确认 preview rebuild 没问题后，再让 serving alias 指向新的 physical collection

动作：

- handbook / curriculum 分别执行正式 publish
- 不手动改 alias；仍通过 repo 自带 release shell 完成

命令模板：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <curriculum_raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --publish-alias
```

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus regulations \
  --collection student_handbook \
  --raw-version-id <handbook_raw_version_id> \
  --source-pdf 学生手册_2018.pdf \
  --publish-alias
```

然后重启 Wave 0 的本地 runtime，并做两条 smoke：

- `民族学本科人才培养方案`
- `中央民族大学本科学生国家奖学金评审办法`

通过标准：

- `/api/internal/evals/chat/requests` 返回 `200`
- `answer.result.kind` 不再是 `error`
- `supervisor.status` 不再是 `error`

完成定义：

- 本地 serving alias 已重新回到 canonical rebuild truth
- representative handbook / curriculum live query 可以稳定穿过 supervisor / retrieval path

### Wave 4：重跑 live accept，收口 artifact

目标：

- 在 runtime 不再 crash 的前提下，重新生成可消费的 live benchmark truth

命令模板：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept \
  --reruns 3 \
  --verbose \
  --log-jsonl .tmp/evals/curriculum-runtime-events-<timestamp>.jsonl \
  --output-dir .tmp/evals/curriculum-plan-live-gate-accept-<timestamp>
```

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept \
  --reruns 3 \
  --verbose \
  --log-jsonl .tmp/evals/student-handbook-runtime-events-<timestamp>.jsonl \
  --output-dir .tmp/evals/student-handbook-formal-benchmark-accept-<timestamp>
```

这轮必须至少记录：

- final summary
- gate report
- runtime events jsonl
- preview / publish rebuild report
- smoke 请求样本与 request / trace id

完成定义：

- accept 结果不再由 runtime crash 污染
- deterministic / supplemental verdict 才允许重新被解释成产品质量信号

## 验证门槛

本轮至少要拿到下面四类证据：

1. current serving rows canonical-only 的 SQL 证据
2. preview rebuild 与 publish rebuild 的 report artifact
3. handbook / curriculum 代表问题 smoke 通过
4. 两套 live accept 的 final summary 与 gate report

若后续需要补代码修复，额外至少补：

- `tests.ingestion.test_registry_models`
- `tests.ingestion.test_provider_result_replay_rebuild`
- `tests.api.test_supervisor_api`
- `tests.evals.test_curriculum_live_benchmark`
- `tests.evals.test_handbook_live_benchmark`

## 停止条件

出现下面任一情况时，应停止继续 publish 或 accept，先回到 data-plane 排查：

- preview rebuild 后 current rows 仍有 `acl_groups` / `campus_scope` / `acl_level`
- `supervisor-api` 仍抛出 `unsupported authorization projection keys`
- smoke 仍返回 `status=error`

出现下面情况时，应单独分流为环境问题，而不是继续归因给 registry：

- provider DNS / timeout / credential 错误
- `app-api` local DB drift 或 Hyperdrive local connection 异常
- local worker observability sink 造成的非主链路网络噪声

## 当前建议

先执行 Wave 1 与 Wave 2。

原因：

- 当前 root cause 已经明确落在 local data-plane truth，不需要先改代码
- canonical rebuild 是和现有 ADR / sunset plan 一致的修复方向
- 只有 preview rebuild 先证明 current rows 已 canonical-only，后续 publish alias 与 accept 才有意义
