# Agent Note: 死代码与重复校验治理（2026-09-29）

Status: implemented

## 背景

同批冗余 hash 治理后，对全仓做四路盘点：TS 导出级死代码、Go 导出/私有级死代码、
非 hash 类的重复校验、配置与依赖死代码。本笔记记录本轮治理的取舍。

## 判定原则

- 死代码：全仓（含测试与 docs）`rg -w` 零引用才可删；仅测试引用的 export 属
  "为测而存"的测试基建，不在本轮删除范围。
- 重复校验：每层校验必须对应一个真实信任边界（网络输入、外部 payload、三方库
  返回、DB 行、磁盘读取）；上一层已同等严格校验且无新不信任来源介入的下层
  校验为冗余。
- 自动生成的合同文件（`tool_execution_contract.go` 等）不按引用计数治理：其
  内容由 `docs/contracts/schemas/tool-execution.openapi.yaml` 经
  `packages/contracts` 生成器产出，`contracts:check` 强制同步；schema 是否退役
  要在 YAML 合同层评估（TS 侧 finalization 仍消费 ToolExecutionResponseWire）。

## 决策

### 已删除（TS 死代码，91 项）

- app-api 11 项：未挂载的路由响应助手、`projectStageTimingBudget`、
  `resolveCurriculumFollowUpState`、durable-polling 遗留的 generator 版
  `streamDurableRunEventsUntilTerminal`（queue 版已收口）、SSE 解析链路
  （`parseExecutionControlSse`/`mapExecutionLifecycleEvent`/`parseSseBlock`）等；
- campus-web 13 项：reader-build 三个 escape 助手、`published-reader-blocks.ts`
  整文件（唯一导出无消费者）、`assertCurrentSourceDigest` 等；
- ops-web 24 项：internal-portal 声明式 schema 整文件（表由 campus-agent-schema
  migrations 管理，声明式 drizzle 定义全仓零引用）、
  `request-observability-window.ts` 整文件、ops-display 两个组件、ops-contract
  三个无引用 z.infer 别名等；
- jobs/packages/scripts 42 项：`NOTICE_PIPELINE_TASK_QUEUE` 别名、
  `PublisherIndexCatalog`、`NOTICE_CHUNK_SCHEMA_VERSION`、contracts 多个无引用
  z.infer 别名（schema 本体保留）、scripts/dev 的 product-data-target 整文件等。

### 已删除（Go 死代码）

- execution-control 约 45 项：`LoadPayload`、`InputFailureIsNonRetryable`、
  `DurableRunEventPayloadFingerprint` 导出包装（result_fingerprint 退役遗留）、
  httpapi 6 个私有函数与 `qdrant_payload.go`/`source_ids.go` 两个整文件、
  lifecycle 四个 State 常量、temporaladapter 三处共 9 项、
  `OwnerDeletionStore.OwnerDeletionStatus` 接口方法及 Postgres/InMemory 两个死实现等；
- model-config：`AllConfigNames`（`NewCipher` 被测试直接消费，保留）。

### 已收敛（重复校验）

- dining 投稿链：service 层对路由层已 safeParse 的 metadata 再次 parse，移除；
- account-admin 理由链：`normalizeReason` 与 `AccountAdminReasonSchema`
  （trim+min1+max500，trim 为 transform）完全等价，移除 service 层；
- agent-runtime：`resolveModelRuntimeConfig` 对 contract 已正则校验的
  `expected_model_target_sha256` 重复校验，移除并删对应测试；
- ops-web transport PATCH：`TransportRouteInputSchema` 无跨字段约束，patch 与
  DB 当前值各自校验后合并产物必合法，第三层 parse 移除；
- notice embedding：provider 返回边界校验（embedding-runtime）保留，cache 写入
  回调与 payload 构造两处同进程重复校验移除；embedding-set 与 embedding-cache
  两份 model target sha256 正则收敛为单一导出；
- synthesis adapter：Runtime 不回传请求中已准入的 evidence/source attempts，
  adapter 不再对两份同源材料做 SHA-256 自比较；adapter 仍拒绝 Runtime 越过合同
  回传这些材料，并继续保留来源身份、准入、provider citation span 与最终 citation
  closure 校验；
- chat feedback 的不可达 `Array.isArray` 分支、profile memory 的静态类型守卫移除。

### 配置与依赖

- K8s：移除 notice-pipeline-worker 的 `EXECUTION_CONTROL_DATABASE_URL` 与
  ops-web 的 `OPS_WEB_LANGFUSE_URL` 两处代码零消费的注入；
- package.json：移除 9 个包共 30 个声明但从未 import 的依赖
  （campus-web 的 6 个 radix 包由 packages/ui 自己的依赖承载，属副本）。

### 明确不做

- packages/ui 的 shadcn 风格完整 API 面（`AlertDialogAction`、`Drawer*` 等）：
  组件库 API 完整性属产品决策；
- 293 项"仅本文件使用的 export"：代码存活，收紧 API 面是长尾低收益改动；
- EC 的 InMemory 持久化集群（约 80 项仅测试引用）：为测而存的测试基建；
- 316 项 phantom type：类型仅被定义文件使用，属风格问题；
- `campus-agent-database-config` 的 PG*/NOTICES_* 双轨键：7 个 workload 经
  envFrom 消费共享键，值一致无漂移，改造为精准注入的收益不抵风险。

## 未采用方案

- 在 YAML 合同层退役 ToolExecutionResponseWire 等 schema：TS 侧 app-api finalization
  contract 仍是真实消费者，未到退役时机；
- 将 `campus-agent-database-config` 的 envFrom 全量注入改造为逐键精准注入：
  涉及 7 个 workload 与双轨键并存的历史包袱，值一致无漂移，风险不抵收益；
- 删除仅测试引用的 InMemory 持久化集群与 phantom types：前者是既有测试基建，
  后者是风格问题，均不属死代码完成标准。

## 后果

全仓减少约 1300 行死代码与 30 个无效依赖声明；高频路径（embedding cache 写入、
dining 投稿、transport 更新）各少一次重复校验；`tool_execution_contract.go` 的
合同生成机制澄清——治理此类文件必须改 YAML 源而非产物。
