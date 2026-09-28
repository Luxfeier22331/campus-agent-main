# Agent Note: 退役本地 OTel Collector 与 infra/otel 目录

Status: implemented

## 背景

源码仓曾有的 `infra/otel/` 目录（已退役）维护两份本地 Collector 配置：`collector-local-debug.yaml`（Agent trace → debug exporter）和
`collector-local-prodlike.yaml`（Agent trace → Collector → Langfuse）。配套的
langfuse compose overlay、collector 配置校验脚本和 otel 手册把这条链路写成"prodlike"。

架构评审发现三件事：

- 线上 Langfuse 是外部云服务（`LANGFUSE_BASE_URL: https://jp.cloud.langfuse.com`），Agent Runtime 经
  `LangfuseSpanProcessor` + `OTEL_EXPORTER_OTLP_*` **直连云**，中间没有 Collector。
- GitOps 环境仓的观测文档明确"本仓库不部署 OpenTelemetry Agent 或 Gateway"、"不配置 Langfuse
  ingestion 链路"，并已退役 Collector；全仓无任何 collector/otlp 部署清单。
- 因此 prodlike 配置模拟的是一条**线上不存在的链路**，README 声称的"环境仓拥有实际
  receiver/pipeline/endpoint"是空转的所有权声明；本地 debug collector 诊断也无人使用。

已退役的 `infra/otel/` 还违反放置语义：本地调试配置顶着 `infra`（目标环境部署事实）名号，且与引用它的 compose
（`infra/local/`）分离。

## 决策

连同 debug 配置一并全部删除（用户确认 debug 无人使用）：

- 删除 `infra/otel/`（两份 collector 配置 + README）。
- 删除 langfuse compose overlay 整文件，删除 `docker-compose.execution-runtime.yml`
  的 `otel-collector` 服务（含 4318 端口与 healthcheck）。
- 删除 collector 配置校验脚本，删除 `validation-profiles.mts` 的 `otel` profile、`evidence.mts`
  verify 流程里的 `otel` profile、`.github/workflows/manual-evidence.yml` 的 `- otel` 选项。
- 删除 otel 手册，同步改写 `langfuse-runtime.md`（Collector 段改为"直连 Langfuse 云"）、
  `telemetry.md`、`hindsight.md`、`verification.md` 与本地 compose 和 runbook 的索引。
- Agent Runtime 运行时不受影响：`telemetry.ts` 本就支持 `OTEL_EXPORTER_OTLP_*` 直连云。

## 未采用方案

- 保留 debug 配置（本地 stdout 看 span，不依赖 Langfuse）：用户确认无人使用，且直连云后本地 span 可直接在
  Langfuse 云查看，无独立价值。
- 把 collector 配置移到 `infra/local/` 与 compose 同处：只解决位置错位，不解决"模拟链路已被环境仓退役"
  的根本问题。
- 保留 `otel` validation profile 但改成校验"无 collector"：无校验对象，徒增空置流程。

## 后果

- 源码仓不再有任何 Collector 配置、校验脚本、validation profile 或文档把 Collector 写成现役；
  `pnpm verify` 的 profile 集合不再含 `otel`。
- Agent Runtime 本地 dev 本就不需要 Collector（无 `OTEL_EXPORTER_OTLP_*` 时跳过导出），删除不伤本地开发。
- [可观测数据边界](../architecture/2026-07-17-observability-planes.md) 中"本地 Collector 单 receiver Agent trace pipeline"
  一节被本篇取代（Agent Runtime 仍是唯一可选 OTel trace producer，但出口改为直连云）。
- 若未来重新引入 Collector（如自建网关做采样/批处理），需新建决策并同步 GitOps，不与本篇冲突。
