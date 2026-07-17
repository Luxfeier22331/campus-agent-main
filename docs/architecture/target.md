---
doc_type: architecture
owner_boundary: docs/architecture
status: active
---

# 目标架构

## 文档边界

本文只规定长期不得回退的系统约束。它不描述当前完成度、实施顺序、优先级、环境状态或
具体字段；当前实现、部署状态和接口字段分别由 `current.md`、环境仓和所属合同维护。未合并
的计划和待办不进入本文。

## 目标拓扑

```text
浏览器或渠道
-> 产品界面
-> app-api 身份、会话与对话传输
-> execution-control 持久执行准入
-> Temporal workflow
   -> 记忆召回
   -> 一个包含完整 SDK run 的 Agent Activity
   -> 终结
   -> 记忆追加
-> 脱敏持久投影
-> 产品响应、Ops Web 与评测
```

离线数据链保持独立：

```text
来源准入
-> Temporal 采集 workflow
-> 来源采集器或确定性内核
-> 不可变来源与结果产物
-> 规范文档、分块与索引发布
-> 显式查询目标准入
```

## 产品边界

- app-api 是账号、session、conversation、产品 API 和产品终态的唯一后端所有者；
- browser surface 不直连 execution-control、数据库、Temporal、向量库、对象存储或观测平台；
- execution-control 是内部执行引擎，不扩张成第二个产品后端；
- 运维只读面、产品配置面和学生产品面保持独立权限边界；
- 同一事实只有一个写入所有者，其他消费面读取投影或调用受控接口；
- 不为单个页面或单个工具拆出没有独立数据、扩缩容或安全所有权的微服务。

## 持久执行

- Temporal 拥有 workflow history、task queue、retry、timeout、heartbeat、timer 和 cancellation；
- execution-control 拥有 run admission、Temporal command/query、工具和 target 准入、受控投影及
  finalization 校验；
- OpenAI Agents SDK 是唯一在线 agent/tool loop 所有者；
- 一次问答只有 Memory Recall、一个完整 Agent Activity、Finalization、Memory Append 四阶段；
- SDK function call、handoff、检索和回答综合不得展开成平行 Temporal graph；
- workflow code 不做语义工具选择，finalization 不调用模型或重写答案；
- HTTP 连接断开不终止持久执行；恢复读取同一个 run 的持久事件；
- cancellation 和 deadline 必须传播到 provider、memory 和 internal query；
- late completion 不得覆盖已终态 run。

长期 worker 只按执行特性拆成 workflow、core activity 和 agent activity pool，不按知识、
工具或 specialist 拆 queue。

## Agent 与工具

- Primary Agent 在已准入的 model-visible 集合中直接决定回答、澄清、拒绝、function call 或
  official handoff；
- `knowledge_query` 表达进入 Knowledge Agent 的用户意图级 handoff；
- `knowledge_search` 是 Knowledge Agent 可见的 internal-only tool；
- deterministic campus service 作为窄 function tool 调用所属内部读服务；
- 工具注册表必须固定名称、暴露范围、schema、handler、超时和结果投影策略；
- schema 或配置存在不自动开放工具；开放必须同时具备 runtime registry、handler、合同、测试和
  评测分母；
- browser、模型和 caller 不选择 collection、index alias、provider 或任意数据库查询；
- 不恢复 provider built-in web search、remote MCP 或现场 source capture 作为默认回答 fallback。

## 检索与证据

- 机构知识检索只通过显式 query-serving target registry 开放；
- target 绑定语义 ID、collection 和服务端配置，不把内部检索参数暴露给模型或浏览器；
- Knowledge Agent 负责 query framing 和基于证据回答，execution-control 负责访问控制、检索、
  有界证据投影和终态证据校验；
- candidate、最终采用证据和 browser source 必须分层；
- finalization 只接受当前 run 已投影且通过来源校验的 evidence ref；
- 默认查询当前版本；历史、截至日期和版本比较必须由明确请求触发；
- reader 可见、source 已采集或 index 文件存在都不等于 target 已开放。

## 个人记忆

- 个人记忆、机构知识和账号/session 是三套独立真相；
- Hindsight 拥有个人记忆提取、合并、图存储、retain、recall 和 reflect；
- execution-control 通过受控 activity 消费有界记忆上下文；
- app-api 只拥有用户可见的记忆设置和产品投影，不把 PostgreSQL profile rows 当作在线 recall
  真相；
- memory 可以影响跟进、偏好、消歧、query framing 和措辞，但不能授予权限、开放工具、改变来源
  信任或放宽证据要求；
- 内部 bank、operation、document ref 和原始 memory payload 不进入学生响应或 model-visible
  tool。

## 数据与采集

- 在线查询和离线采集严格分离；
- source truth、canonical document、chunk、index release、serving alias 和产品读模型分别拥有
  独立生命周期；
- 对象存储保存不可变、带 digest 的大对象和运行 artifact；
- PostgreSQL 保存产品真相和有界查询投影，不复制 raw source、Temporal history 或 vendor trace；
- Qdrant 只承载机构知识索引，不能重新承担个人记忆；
- ingestion caller 只提交受版本约束的 task envelope，不能选择 executor 或绕过 registry；
- 大量 source observation 和详细错误留在对象存储，不写入 workflow history 或逐项数据库行；
- ingestion 完成与在线发布是两个明确步骤，任何 target 必须经过独立发布和准入。

## 观测与评测

- W3C trace context 和稳定关联标识贯穿产品入口、执行、Temporal、模型和受控投影；
- 产品遥测只保存白名单字段，不包含 prompt、回答、检索正文、认证材料或 secret；
- Langfuse 可以在受信任边界保存模型诊断所需 trace，并拥有 dataset、score、annotation 和
  experiment；
- OpenTelemetry Collector 负责 Kubernetes 通用信号的分权入口、字段删除、采样、批处理和
  环境选择的 sink 转发；Sentry SDK 和 Cloudflare application log destination 是明确例外，后者
  只允许 producer 清理后的 console logs，并必须以下游哨兵验证；
- Cloudflare invocation logs 与 native traces 保持关闭；后端请求 trace 通过 W3C context 进入
  execution-control 和 Collector，作为 Axiom/Langfuse 的请求关联证据；
- Ops Web 提供跨系统常用摘要和关联入口，不复制 Temporal UI、Langfuse UI 或日志平台的全部能力；
- runtime 合同测试拥有确定性不变量，Ragas/Langfuse score 用于质量评审，不替代合同测试或自动
  形成发布结论；
- 不建设第二套自研 trace store、eval 平台、annotation queue 或 release-gate framework。

## 部署

- source repo 产出不可变镜像、Worker 候选版本、schema 和 namespace-neutral base；
- 环境仓选择版本、流量、namespace、Secret、数据库和平台配置；
- Cloudflare 和 Kubernetes 的变更均通过环境仓声明与审查，不由应用运行时自行部署；
- Temporal Worker Controller 和 KEDA/HPA 可以管理版本和副本，但不拥有 workflow 或产品状态；
- Secret 不进入 Git、镜像、ConfigMap、前端 bundle 或可观测 payload；
- 本地 Compose、源码清单和 CI build 都不能代替真实环境状态。

## 禁止回退

- Python supervisor 或 ingestion worker 回到在线主链；
- bootstrap mega-agent、隐藏兼容 router 或双执行路径；
- app-api 内嵌 agent loop、Temporal worker、采集或通用运维代理；
- 按工具拆 Temporal specialist graph；
- PostgreSQL 重新承担执行队列或 Temporal history；
- 在线查询直接读取 raw object-store artifact 或 source collector；
- 通过 fallback、silent success 或 best-effort 路径掩盖缺失合同和下游故障。

## 所有者文档

- 产品运行时：`system/product-runtime.md`
- 持久执行：`system/durable-runtime.md`
- Agent SDK：`system/agent-framework.md`
- 工具：`system/tool-runtime.md`、`system/tool-routing.md`
- 检索：`system/retrieval-serving.md`、`system/agentic-retrieval.md`
- 记忆：`system/memory-plane.md`
- 数据面：`system/data-plane.md`
- 可观测性：`system/ops-observability.md`、`system/langfuse.md`
- Kubernetes：`system/k8s-runtime.md`
- 合同和数据：`../contracts/README.md`、`../data/README.md`
