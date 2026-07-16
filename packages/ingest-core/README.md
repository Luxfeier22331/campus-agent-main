# ingest-core

campus-agent 采集数据面的 runtime-neutral helper。

本 package 拥有 collector runtime、ingestion-control handler 与 job 共享的 TypeScript 采集
helper 语义。它不是可部署 runtime，不得导入 Temporal、Crawlee、具体 object-store client、
database client、provider transport 或 env bootstrap。

## 负责范围

- artifact ref、`s3://` URI 与 sha256 digest helper；
- runtime-neutral object-store interface；
- TS-only 边界上由 Zod 支撑的 source-channel handoff DTO、collection runtime、chunk profile 和
  Rust kernel output parser；
- 确定性 source-truth object key builder；
- 基于 package canonical JSON helper 的 JSON / JSON Lines artifact writer；
- 认证通知 notice-family config 解析、确定性 route decision、capture-route attachment retention
  与 source-truth inventory helper；
- ingestion task registry catalog 查询与默认 executor 可执行性审计；
- 通过 `ingest-core/node` 提供仅 Node 使用的 registry 文件加载。

runtime code 必须留在 `apps/*` 或 `jobs/*`。

`ingest-core` 是通用 source handoff parsing、collection profile payload validation、canonical
artifact serialization、digest comparison 与 source-truth key construction 的唯一 TS
所有者。`apps/ingestion-control` 中的 runtime handler 应调用这些 helper，不得另行实现 JSON
sorting、handoff validator、profile parser 或 artifact writer。

当前默认 task 执行与共享 task 合同要求 `input_ref.kind=object_store`。`inline`、`local_file`
与 `postgres_row` 已退役，不得重新进入 runtime task envelope。

认证通知 inventory helper 只把 registry-like row 与 source-truth payload 转换为确定性 DTO，
不拥有 inventory store、全量重建、attachment byte inspection、OCR/provider execution 或下游
materialization lifecycle。

认证通知 routing helper 要求调用方注入已解析的 notice-family config。runtime 文件加载属于
`apps/ingestion-control` 或其他可部署 runtime，不属于本 package。

## 禁止范围

- Temporal workflow/activity client、worker setup 或 execution；
- Crawlee collector、router、browser/page state 或 crawler storage；
- 具体 S3、Postgres、Qdrant、provider 或 env bootstrap client；
- collection profile 文件发现、env projection 或 runtime config 加载；
- collection lifecycle、task lease/claim/retry/dead-letter 或 closeout storage；
- terminal closeout mutation；
- registry-aware runtime dispatcher、具体 TS handler registry、具体 Rust kernel registry 或稳定
  execution error-code mapping；
- 来源专用 capture runtime code。
