---
doc_type: requirements
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: Ingestion Worker Independent Deployment Hardening

## Goal

让 `apps/ingestion-worker` 能作为服务器侧独立部署单元稳定运行：

`scheduler/timer -> bounded CLI -> JSON report -> retained evidence / alert -> exit`

目标部署产物是 Docker image；当前先补本地 dev 可重复运行路径，再补 Docker 与服务器调度
闭环。

## Success Criteria

- 存在明确的部署产物或安装流程，不依赖临时手工命令拼装。
- 每个 admitted batch kind 都有可复制的 run script / timer / env contract。
- deploy preflight 能 fail-fast 检查 CLI、DB、object store、report dir 与 batch-specific
  provider 依赖。
- 调度层具备单实例并发保护，避免 timer overlap。
- batch resource policy 能限制附件大小、OCR 文件大小、batch item count、concurrency 与
  OCR response cache。
- MinerU / attachment 主路径不再强制把大附件和 provider archive 长时间保留在 Python heap。
- JSON report 有固定留存目录、轮转策略和失败排查路径。
- JSON report 能记录 peak RSS、最大附件 bytes、最大 provider archive bytes、OCR 次数、
  cache 行为、跳过原因与失败分类。
- 失败能通过 systemd / cron / operator channel 形成可见告警。
- 本地 smoke、server dry-run、server writable small-batch、scheduled run 四个验收步骤清晰。

## Non-Goals

- 不重写 `packages/ingestion-core` 的 canonical data-plane 语义。
- 不把 ingestion worker 接入 online query path。
- 不为每日十条级别 notice 引入常驻服务、queue daemon 或多实例 worker pool。
- 不在 root `.env.example` 恢复 domain-specific DB override 污染。
- 不把 `--promote` 写进无人工检查的默认首轮调度模板。
- 不把外部 MinerU API 路径误建模成本机 OCR 模型路径。
- 不把课程地图 / service navigation 专用 PDF render 路径提升为 notice OCR 主路径要求。

## Captured Gaps

### Resource / Memory Gaps

| Gap | Problem | Required Closure |
|-----|---------|------------------|
| `INGEST-RES-01` | attachment 主路径通过 `object_store.get_bytes(...)` 全量载入 bytes | 引入 file-backed / streaming object read capability；至少 authenticated notice attachment 路径可边下载边 hash、边写 temp file |
| `INGEST-RES-02` | MinerU 客户端上传前 `read_bytes()`，上传和 archive 下载以完整 bytes 传递 | 改成 file-backed upload 与 streamed archive download；小文件可兼容 bytes，大文件走文件或 artifact reference |
| `INGEST-RES-03` | `OnlineOcrProviderResult` / `raw_provider_artifacts` 以 bytes 为主 | 设计 provider artifact reference 形态，避免大 archive 长时间留在 process heap |
| `INGEST-RES-04` | `ocr_provider_response_cache: dict[str, bytes]` 无容量边界 | batch 默认禁用或按 max entries / max bytes 限制，只缓存小结果 |
| `INGEST-RES-05` | oversized PDF split 后会累积 segment bytes、canonical segments、raw provider artifacts | 改为逐段处理、逐段持久化、最后合并 canonical 输出 |
| `INGEST-RES-06` | batch 入口缺统一附件大小、OCR 文件大小、batch count、concurrency 资源闸门 | 增加 worker resource policy，并在 report 中记录跳过 / 限流原因 |
| `INGEST-RES-07` | resource report 只记录 process step peak RSS，缺 attachment / archive / cache 细分指标 | report schema 增加 resource summary 与 per-batch metric |

### Ops / Deployment Gaps

| Gap | Problem | Required Closure |
|-----|---------|------------------|
| `INGEST-OPS-01` | 缺独立 deploy artifact / install path | Docker image 为主路径，本地 dev 继续用 `uv run --package campus-ingestion-worker ...` |
| `INGEST-OPS-02` | systemd service 只有最小 `oneshot` 模板，缺硬化细节 | 补 Docker-trigger 或 CLI-trigger unit 模板，包含 user、env file、timeout、hardening、日志目录权限 |
| `INGEST-OPS-03` | 当前只有 `internal-notice-multimodal-drain` 有脚本和 timer 模板 | 为 admitted batch kinds 补统一 operator script：internal notice、official web handoff、authenticated notice closeout、wechat public notice projection |
| `INGEST-OPS-04` | 部署级 preflight 只完成基础版本，尚未覆盖所有 resource policy / provider dependency | 扩展 worker preflight 覆盖 Docker/local path、temp dir、resource caps、batch kind dependency、live object store / DB probes |
| `INGEST-OPS-05` | 缺 `flock` 或等价并发锁 | operator shell 统一 acquire lock；overlap 时 fail fast 或 skip with report |
| `INGEST-OPS-06` | report 仍只是本地文件，缺留存 / 轮转 / 上传 / operator 查询策略 | 增加 retention command / script；定义 report dir layout、max age、max count、failed report index |
| `INGEST-OPS-07` | failure alerting 未接线 | 先支持 local log / systemd failure marker / webhook 中一种最小路径，后续再接 Sentry 或邮件 |
| `INGEST-OPS-08` | worker-specific secret matrix 没有最小清单 | 放入 runbook / env inventory，不污染 root `.env.example` |
| `INGEST-OPS-09` | Docker resource boundary 未固化 | image、entrypoint、non-root user、tmp/report mounts、memory/cpu caps、read-only fs 策略落地 |
| `INGEST-OPS-10` | FeedWe rate limit、retention、account scope、delete/update semantics 与 SLA 仍是 production scheduling 风险 | wechat batch 进入默认调度前必须补 provider risk note 与 acceptance gate |

## Resource Budget Targets

初始预算用于同机运行 `supervisor-api` 与按需 ingestion worker，不代表长期容量承诺。

- 默认 batch 进程：`--cpus=1` 或等价 CPU quota。
- 默认 memory cap：`768m`；本地 dev 可无 cap，但 report 必须记录 peak RSS。
- 首轮同机验收目标：低频 notice batch peak RSS 不超过 `512 MiB`；超出则必须回看
  `INGEST-RES-*`。
- 默认 attachment / OCR concurrency：`1`。
- 默认 authenticated notice closeout `parallel-workers=1`，`max-concurrency=1`，只在 report
  证明稳定后再提升。

## Batch Kind Scope

| Batch Kind | Scheduling Status | Planning Treatment |
|------------|-------------------|--------------------|
| `internal-notice-multimodal-drain` | 已有基础 on-demand script / timer 模板 | 先补 lock、resource policy、report retention、Docker lane |
| `official-web-handoffs` | on-demand runner 已覆盖，部署模板未收口 | 补 operator script、preflight dependency、retry / force runbook |
| `authenticated-notice-closeout` | on-demand runner 已覆盖，资源风险最高 | 优先补 attachment / MinerU bytes 生命周期与 conservative concurrency |
| `wechat-public-notices` | preflight batch kind 已存在，但 production scheduling 仍需 provider 风险确认 | 先保留 explicit operator-run lane，不进入默认 timer |
