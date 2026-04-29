---
phase: "H"
name: "LibreOffice Conversion Runtime Productization"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase H Research

## Goal Fit

这份研究只回答 `Phase H` 的 implementation question：

- 如何把 legacy Office（`.doc/.xls`）的 canonical runtime 从当前 worker-direct `soffice --convert-to` 过渡实现，收口为 repo-owned `JODConverter + LibreOffice` self-hosted conversion service

它不重开：

- OCR lane / provider routing
- `official_web` linked-file adoption
- `authenticated_notice file_release`
- regulation downstream
- query-serving reopening

## Current Gap

当前 repo 已经完成了 contract 与 source-path migration，但 runtime truth 仍停在过渡态：

- architecture 已冻结：
  - legacy binary Office production posture = `internal self-hosted conversion service`
  - first implementation = `JODConverter + LibreOffice`
  - 明确禁止业务 worker 每次直接拉起 `soffice --convert-to`
- code 仍是：
  - `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py`
  - 直接 `shutil.which("soffice")`
  - 然后 `subprocess.run([... --headless --convert-to ...])`
- operator truth 缺口：
  - 没有 repo-owned service env contract
  - 没有 deploy shape
  - 没有 health/readiness contract
  - 没有真实 `.doc/.xls` 走 service seam 的 closeout evidence

所以当前缺的不是“装没装 LibreOffice”，而是“LibreOffice-family conversion 有没有被提升成 canonical runtime boundary”。

## Recommended Architecture

### Recommended Stack

- canonical service:
  - `JODConverter + LibreOffice`
- canonical boundary:
  - `packages/ingestion-core` / `apps/ingestion-worker` 只调用 conversion service
  - office process lifecycle 由 service 自己管理
- canonical output:
  - normalized `.docx/.xlsx` artifact
  - shared provenance / diagnostics
  - downstream deterministic OOXML extraction

### Why JODConverter

- `soffice --convert-to` 只是 LibreOffice 的原始 CLI 能力，适合本地脚本或临时转换，不适合作为 repo 的长期服务边界。
- `JODConverter` 的价值不是替代 LibreOffice，而是把 LibreOffice 变成可运营的 conversion runtime：
  - office process start/stop lifecycle
  - task queue
  - timeouts
  - process restart / leak containment
  - concurrent office manager instances
- 对 repo 来说，正确对比不是 `JODConverter vs LibreOffice`，而是：
  - `JODConverter + LibreOffice` self-hosted service
  - 对比
  - 业务 worker 直接 shell out 到 `soffice`

### Boundary Shape

- `packages/ingestion-core`
  - 保持 shared contract owner
  - 定义 request/response schema、artifact semantics、fail-close semantics
- `apps/ingestion-worker`
  - 继续只做 runtime shell / worker entry
  - 负责调用 internal conversion service
- `legacy-office-conversion-service`
  - 独立 service boundary
  - 内部使用 `JODConverter + LibreOffice`
  - 暴露 repo-owned HTTP seam

这和 repo 里已有的 internal service seam 一致：

- `*_BASE_URL`
- `*_INTERNAL_SHARED_SECRET`
- `/healthz`
- `/readyz`

不需要为 LibreOffice service 发明第二套风格。

## Service Contract

### Environment Contract

推荐沿 repo 现有 internal-service 模式命名：

- `LEGACY_OFFICE_CONVERSION_BASE_URL`
- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`
- `LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`

service 自身 env：

- `LIBREOFFICE_SERVICE_BIND`
- `LIBREOFFICE_SERVICE_INTERNAL_SHARED_SECRET`
- `LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_MAX_TASKS_PER_PROCESS`
- `LIBREOFFICE_SERVICE_WORKDIR`
- `LIBREOFFICE_HOME` 或等价 office-home config

### Request Shape

推荐最小 request：

```json
{
  "source_media_type": "application/msword",
  "target_format": "docx",
  "source_sha256": "...",
  "filename": "example.doc",
  "source_bytes_b64": "..."
}
```

`.xls` 同理，只把 `target_format` 变成 `xlsx`。

关键点：

- request 传的是原始 bytes 与 source metadata
- service 不持有 source-truth identity
- `raw_asset_id` / `raw_version_id` / document identity 仍由 repo 上游持有

### Response Shape

推荐最小 success payload：

```json
{
  "target_format": "docx",
  "normalized_media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "normalized_sha256": "...",
  "engine_name": "jodconverter+libreoffice",
  "engine_version": "...",
  "normalized_bytes_b64": "...",
  "warnings": []
}
```

推荐 failure payload：

```json
{
  "error_code": "conversion_failed",
  "message": "...",
  "retryable": false
}
```

### Auth And Admission

- 只允许 internal caller
- admission 固定为 shared-secret header
- 不引入 OAuth、session、public token
- 不暴露公网 conversion endpoint

推荐 header：

- `Authorization: Bearer <internal-shared-secret>`

或沿 repo 现有 internal shared secret header 约定保持一致。

### Timeout / Error Model

需要显式区分 4 类失败：

1. caller contract error
   - 缺字段
   - sha256 不匹配
   - unsupported media type
   - `4xx`
2. conversion runtime unavailable
   - service down
   - queue timeout
   - readiness failed
   - retryable
3. deterministic conversion failure
   - LibreOffice/JODConverter 无法完成转换
   - `conversion_failed`
   - 默认 fail-close，不静默 fallback 到本机 CLI 或 OCR
4. service contract breach
   - reported success but response body missing bytes/hash/format
   - 视为 runtime bug，直接 blocker

### Health / Readiness

- `GET /healthz`
  - service process alive
  - config loaded
- `GET /readyz`
  - 真正能接 conversion task
  - LibreOffice/JODConverter office manager ready
  - temp/work dir writable
  - queue not in degraded state

`readyz` 必须比 `healthz` 更严格，继续沿 repo 当前 Worker/app seam 的 fail-close 习惯。

## Deployment Shape

### Recommended Shape

- standalone self-hosted service process/container

### Why This Is The Best Fit

- 与 repo 已冻结的“internal self-hosted conversion service”完全一致
- 不把 office process lifecycle 塞回业务 worker
- 便于：
  - 独立 health/readiness
  - 独立资源限制
  - 独立 restart policy
  - 后续平滑替换为 `Collabora Online REST` 一类更强后端

### Explicit Rejects

- sidecar per worker
  - 仍把 lifecycle 绑在业务 runtime 上
  - 并发/泄漏/健康管理继续散落
- 业务 worker 直接 shell out `soffice`
  - 这正是当前要移除的长期 debt
- 外部 SaaS default
  - 与 architecture freeze 冲突

## Migration Strategy

### Recommended Path

1. freeze service contract
   - 先把 request/response/env/health contract 写死
2. land conversion client seam
   - 在 `packages/ingestion-core` 新增 service client
   - 保持现有 normalization result/provenance contract 不变
3. route worker through service client
   - `file_asset_legacy_office.py` 不再直接持有 office process lifecycle
4. demote local CLI path
   - 如果短期保留，只能是 dev-only / diagnostic fallback
   - 不得继续作为 canonical production path
5. closeout with real assets
   - 用真实 `.doc/.xls` 证明 service path 成立

### What To Avoid

- 长期双路径：
  - prod 可走 service
  - canonical tests 仍默认走 local `soffice`
- silent fallback：
  - service 失败后静默改走本机 CLI
- source truth drift：
  - 把 normalized `.docx/.xlsx` 误当成新的 source truth

## Provenance And Fail-Close

固定语义应保持：

- source bytes 仍是 source truth
- normalized `.docx/.xlsx` 只是 derived normalization artifact
- provenance 至少记录：
  - source sha256
  - normalized sha256
  - target format
  - engine name/version
  - warnings / diagnostics
  - artifact refs
- service 失败时：
  - 不得伪造 success
  - 不得静默 fallback 到 OCR
  - 不得把半成功输出继续送下游 extraction

## Verification Matrix

### Contract Tests

- service client request building
- shared-secret admission
- timeout/error mapping
- contract breach handling

### Integration Tests

- `.doc -> docx` service success
- `.xls -> xlsx` service success
- service `503` / timeout -> fail-close
- response sha256 mismatch -> fail-close
- response missing bytes -> fail-close

### Worker / Ingestion Tests

- `file_asset_legacy_office.py` 不再直接依赖 `shutil.which("soffice")`
- worker path 通过 `LEGACY_OFFICE_CONVERSION_BASE_URL`
- provenance 继续符合 shared substrate contract

### Real-Asset Evidence

closeout 至少需要：

- 1 个真实 `.doc`
- 1 个真实 `.xls`
- 都来自 repo 当前真实 source channel
- 保留 service path 输出 artifact 和 provenance

### Operator Evidence

- service `healthz` / `readyz`
- runtime env checklist
- deployment runbook
- failure diagnostics 示例

## Open Risks

### Phase-H Scope Risk

- 很容易把这个 phase 错做成“部署一台 Java 服务”
- 正确目标不是只把服务跑起来，而是让 repo 的 canonical path 改为 service seam

### Runtime Drift Risk

- 如果 closeout 时 tests 还默认 mock 本机 `soffice`
- 那么 architecture truth 和 code truth 会继续漂移

### Migration Debt Risk

- 如果保留长期双路径
- 后续每次问题都会退回“到底谁是 canonical path”

## Bottom Line

对这个 repo，最稳的结论是：

- canonical runtime = `JODConverter + LibreOffice` standalone self-hosted conversion service
- repo contract = `*_BASE_URL + *_INTERNAL_SHARED_SECRET + /healthz + /readyz`
- normalized `.docx/.xlsx` = derived artifact，不是 source truth
- migration strategy = 先收口 service seam，再让 worker 改走 service，而不是继续把本机 `soffice` 当默认真相
