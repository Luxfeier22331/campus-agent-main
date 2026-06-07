# campus-contracts

`packages/contracts` 定义 `campus-agent` 的共享 schema 边界。

它负责：

- supervisor-facing `SupervisorRequest`
- supervisor -> agent 的 `AgentRequest` / `AgentResponse`
- retrieval-oriented `EvidenceBundle`
- navigation / structured-runtime handoff 所需的共享 payload / result 分支
- trace、actor、error、scope 等共享 dataclass 与枚举

它不负责：

- runtime / framework / transport 类型
- retrieval backend、Qdrant、MinIO、registry 或其他基础设施类型
- agent 内部实现细节
- `supervisor_bridge_v6`、`runtime_decisions` 或 app-api / execution-control execution
  transport wrapper

当前它已经不是 rag-only contract 面；共享 handoff 现在覆盖 `rag-agent`、`navigation-agent` 与已
admission 的 structured runtime target。`AgentRequest` / `AgentResponse` 是当前
canonical supervisor -> agent handoff DTO；`agent_response` 是 private bridge v6
response contract 名称。

## Machine-Readable Schemas

- `packages/contracts/schemas/agent-handoff.v1.schema.json` 是 package-owned agent
  handoff JSON Schema，覆盖 `AgentRequest` / `AgentResponse`
- `docs/contracts/schemas/supervisor-execution.openapi.yaml` 是 app-api /
  execution-control / supervisor-agent-worker execution wrapper 的 canonical OpenAPI
  schema
- cross-language generated artifacts 由
  `uv run --all-packages python -m scripts.generate_supervisor_execution_contracts`
  生成，并由 `--check` 和 `multi-agent-runtime-contract` gate 防漂移

新增共享字段时，先判断它属于稳定 agent handoff 还是 execution wrapper。前者进入
`packages/contracts`；后者只进入 `docs/contracts/schemas/supervisor-execution.openapi.yaml`
及其生成物。
