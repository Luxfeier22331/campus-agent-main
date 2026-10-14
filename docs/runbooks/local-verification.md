---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发使用 `infra/local/docker-compose.dev.yml` 提供每个 worktree 独立的 PostgreSQL、RustFS、Qdrant 和 Temporal；仓库不在
Kubernetes/GitOps 之外维护第二套 staging 生命周期。`infra/local/docker-compose.execution-runtime.yml` 只用于按需
启动 Hindsight。

未配置 Hindsight 时，agent-control 不向模型暴露 `personal_memory_recall`，普通对话仍使用真实
模型链路；验证个人记忆时再显式启动并配置 Hindsight。

产品页面本地开发使用 worktree profile 和应用本地托管环境文件，不读取根 `.env`。仓库生成 loopback
数据库凭据和应用本地随机 secret；linked worktree 通过显式 `dev:local credentials import` 按 projection 白名单补充尚未存在的 provider
外部开发连接，并在 `internal-portal-collection` projection 下首次导入 main 已有的门户 TGC。数据库、
对象存储资源、应用内部 secret 和 provider 配置加密 key 仍按 worktree 独立。其他外部凭据由开发者进程环境显式提供。

默认诊断 compose 只提供 Hindsight；Agent trace 不经过本地 Collector。只有验证本地 Agent trace 到
Langfuse 的转发时，才在进程环境显式提供 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或
`OTEL_EXPORTER_OTLP_ENDPOINT`，并按 Langfuse 运行合同启动对应依赖。

独立数据平面决策见[每个 worktree 的独立本地数据平面](../../.agents/notes/implemented/architecture/2026-09-24-independent-worktree-data-plane.md)；数据域与初始化命令边界见[本地开发初始化与数据域 owner](../../.agents/notes/implemented/architecture/2026-10-03-local-development-initialization-ownership.md)。

### 本地内部凭据改名

已有 `var/dev/local-secrets.json` 的 worktree 在切换到 schema v3 时，停止本地服务后原值更新字段：

```bash
python3 - <<'PYTHON'
import json
from pathlib import Path
path = Path("var/dev/local-secrets.json")
value = json.loads(path.read_text())
if value["schemaVersion"] in (1, 2):
    value["internalSharedSecret"] = value.pop("executionSharedSecret")
    value["schemaVersion"] = 3
    path.write_text(json.dumps(value, indent=2) + "\n")
PYTHON
pnpm dev:init -- --target core
```

该操作保留所有凭据原值；重新渲染后 App API 与 Control 使用 `APP_API_INTERNAL_SHARED_SECRET`。
新 worktree 直接生成 v3，不需要迁移。

## Node 工具链

Node 版本以根目录 `.node-version` 为准。使用 fnm 的本地环境在当前 worktree 执行：

```bash
fnm install
fnm use
corepack enable pnpm
node --version
pnpm --version
```

CI 使用 `nix develop .#ci-core`；Node 与 pnpm 的启动解释器使用同一版本。
当前 nixpkgs 的 Node 版本落后，`nix/tools.nix` 下载并校验官方 Linux x64/arm64 二进制，
只执行解包与动态链接修正，不编译 Node 源码。升级时同步该文件的两个 SHA-256、
`.node-version`、Bake 和 Dockerfile 默认值；nixpkgs 提供匹配版本及二进制缓存后可恢复使用其包。

## Worker 检查

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
```

## Campus Web 与文档阅读

```bash
pnpm --dir apps/campus-web test:node:fast
pnpm --dir apps/campus-web test:dom:fast
pnpm --dir apps/campus-web build:fixture
pnpm dev:init -- --target core
pnpm dev:local -- data seed --domain docs
pnpm dev
```

`build:fixture` 只供浏览器回归使用确定性测试内容。Campus Web 的正常开发和构建读取当前 worktree 对象存储中的 `campus-docs/source.json`。
`pnpm dev:init -- --target core` 为当前 worktree 供应 PostgreSQL、RustFS、Qdrant、Temporal，安装 schema、测试账号和 namespace；不会导入 provider 凭据、seed 模型或业务数据。
测试账号由 [`apps/app-api/ops/db/seed-local-test-user.ts`](../../apps/app-api/ops/db/seed-local-test-user.ts) 种入：`test@muc.edu.cn` / `password123`（普通用户）、`admin@muc.edu.cn` / `admin123`（管理员）。

`dev:init` 只准备所选 target 的环境、基础设施、schema 和必要账号。按需显式准备模型、调度和数据：

```bash
pnpm dev:init -- --target core
pnpm dev:local -- credentials import --target core
pnpm dev:local -- models seed --target core
pnpm dev:local -- data seed --domain all
pnpm dev:doctor -- --target core --scope startup
```

`data seed` 支持 `notices`、`groups`、`dining`、`transport`、`docs`、`retrieval`，可重复传入 `--domain`；`all` 仅用于 seed。每个已有数据域默认保留并跳过，空域独立初始化。替换必须指明域并传 `--replace`，例如 `pnpm dev:local -- data seed --domain dining --replace`。食堂评价随食堂替换清理；通知有班车引用时，替换必须同时选择 `notices` 和 `transport`。

集群同步使用 `data sync --domain <domain>`，namespace 默认 `campus-agent-staging`，可用 `--namespace` 覆盖；`--context` 省略时使用 kubectl 当前 context。检索同步把 Docs、通知源和当前索引作为一个 owner 闭包，其他业务域分别从既有只读导出 owner 同步。示例：

```bash
pnpm dev:local -- data sync --domain notices --context <context>
pnpm dev:local -- data sync --domain dining --context <context> --namespace campus-agent-staging
pnpm dev:local -- data sync --domain retrieval --context <context>
pnpm dev:doctor -- --scope data --domain notices --domain docs
```

通知日期范围和 `--with-sources` 仅用于选择了 `notices` 的同步；`--with-sources` 复制正文和其图片/附件对象闭包，不带该参数只同步关系数据。日期范围用于 upsert，不与 `--replace` 组合。`data sync --domain notices` 保留本地额外通知并按既有 upsert 路径报告额外记录。`dev:sync-notices` 保留为同一通知同步 owner 的快捷入口。

需要自行验证通知分块和 Embedding 时，使用仅通知源数据同步入口：

```bash
pnpm dev:sync-notices -- --context <context> --namespace campus-agent-staging
```

按通知发布时间选取日期范围时，成对传入 `--released-from` 和 `--released-to`：

```bash
pnpm dev:sync-notices -- --context <context> --namespace campus-agent-staging \
  --released-from 2026-09-01 --released-to 2026-10-03
```

日期使用北京时间 `YYYY-MM-DD`，按 `released_at` 筛选半开区间 `[from,to)`；上述命令包含
2026-09-01 至 2026-10-02 全天。只传一侧、日期无效或起点不早于终点时，在连接集群前报错。
不传日期参数则全量同步。范围内的已发布和未发布通知均包含在内。

命令要求当前 worktree 的 profile、PostgreSQL 和通知 schema 已存在；只读取集群
`pg-product-data-ro`，按一致快照导出选中通知及其引用的分类、类型和组织，在本地事务中按原 ID
插入或更新四张表。它不执行 core 初始化，不要求应用离线；不读取对象存储或 Qdrant，不同步
图片、附件记录及文件、Docs、旧向量或索引指针，也不重新生成 Embedding。通知正文阅读可以验证，
图片与附件的完整阅读体验不在这个入口的交付范围。

同步保留本次导入之外的本地通知及关联数据，包括范围外记录；空结果不删除任何记录。
输出 `selection`（全量时为 `null`，范围同步时为带 `+08:00` 的起止边界）、`source_notices`、`source_chunk_eligible`、`inserted`、
`updated`、`unchanged`、`mismatched`、`related_rows`、`local_extra_count`、`local_extra_ids` 和
`local_extra_chunk_eligible`。`local_extra_*` 按本地全库统计未参与此次导入的通知，包括范围外记录，
不表示同步失败。提交前逐字段核对导入结果，外键或内容验证失败时整批回滚。
重复执行同一命令可更新集群通知；本地总量可能比集群多，不能仅凭总数判断同步是否成功。
后续全库分块也会读取符合条件的本地独有通知，执行前应结合额外记录报告确定评测语料范围。

通知源数据同步验证使用临时空数据库，可通过 `NOTICE_SYNC_TEST_DATABASE_URL` 显式指定并运行
`pnpm exec tsx --test scripts/dev/product-data/notice-sync.test.ts`；测试从既有 migration 提取通知表
及约束，覆盖北京时间起止边界、关联记录筛选、空结果、重复导入、正文更新、本地记录保留和关系错误时的事务回滚。
日期参数与 CLI 前置校验测试通过 `pnpm exec tsx --test scripts/dev/product-data/notice-sync-options.test.ts` 运行。

同步失败时当前 profile 的 current pointer 不会激活候选 collection；修复集群连接或对象后重试同一条同步命令。

浏览器验收按需使用 MCP，不增加 smoke 命令或 PR CI。

初始化成功后不再自动进行全量诊断。默认 doctor 与启动检查只核对必要入口；业务表为空不代表损坏。
需要检查全部对象、图片及检索点引用时显式运行 `pnpm dev:doctor -- --scope data --domain retrieval`，它会读取全部相关
对象并分页扫描当前 collection，诊断成本随数据量增长。数据库约束和实际引用检查仍然有效。

`pnpm dev` 随后检查 startup scope（所选服务的配置、基础设施、schema 与必要数据入口），再由 Turbo 并行启动
Campus Web、app-api、agent-control 和 agent-runtime。它不隐式执行初始化、迁移或 seed。
直接执行 `pnpm --dir apps/campus-web build` 也会读取当前 worktree 的托管配置。只有显式访问其他对象
存储时才通过 `env/commands/campus-docs-source.env` 或进程环境覆盖，进程环境优先级最高。

文档准备进程读取对象存储配置并生成按来源摘要命名的本地目录；随后启动的 Vite 进程只接收该目录、
构建目标和页面运行所需配置，不接收对象存储凭据。没有对象存储访问时，应使用 `build:fixture` 和
Worker fixture 检查，不要把测试环境改成读取远端文档。

真实流式验收先确认进程已加载当前源码：Agent Runtime 的本地 Node 进程和 agent-control 的
Go 进程需要显式重启。使用已初始化的开发账号发起会话，等待产品终态后再提交下一轮，不把手动
取消当作正常收尾的验证。检查页面文本增长、`request.completed` 和持久状态；客户端计时上报
返回 204 只说明接收成功，还应确认两项值同起点、首渲染不早于首 delta，并且不会阻断终态。

### 模型输出格式失败验收

模型格式失败的归一化、证据保留与恢复合成由 Runtime 的 runner、Activities 和 Workflow 测试覆盖。
旧 HTTP Runtime 的 `model-output-failure-server.ts` fixture 已退役。需要真实模型验收时使用普通
Worker 发起会话；发生格式错误后核对失败步骤、保留的检索材料、最终产品状态及 Ops 的模型输出诊断。
不能以没有诊断记录推断模型返回空文本，也不能把恢复合成成功改写为原步骤成功。

初始化失败时运行：

```bash
pnpm dev:doctor
pnpm dev:instances
```

`pnpm dev:doctor` 默认检查当前 target 的配置、实例资源和 owner readiness；使用
`pnpm dev:doctor -- --scope infra` 检查当前 profile 的容器运行状态、健康检查、网络、数据卷和 bucket，
`--scope runtime` 还检查当前 target 的 HTTP health endpoint。无法探测时显示 `unknown`，不会把连接失败当成资源不存在。Temporal namespace 按 profile 创建；实例的 derived bucket 只在 target 声明需要时
供应，notice-classifier 等 database-only target 不会无条件创建它。

`pnpm dev:instances` 是 metadata-only 清单，只读取注册表，不访问 PostgreSQL、RustFS 或 Temporal；
`pnpm dev:instances -- --verify` 才为每条记录探测 worktree、database、derived bucket 和 namespace。
默认清单中的记录显示为 `registered` 或 `stale`，验证清单显示 `ready`、`stale`、`partial`、`unprovisioned` 或
`unknown`。worktree 已删除但资源仍存在时只标记
为 `stale`，不会自动清理。先用 `pnpm dev:prune` 列出 stale 记录，再确认单个实例 ID 后执行：

```bash
pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>
```

删除 linked worktree 前，先运行上述销毁命令；不要在任一 worktree 执行旧 shared compose 的 `down` 或
`down -v`。旧 shared compose project、网络、卷和 bucket 不由代码自动删除，确认无其他消费者后由开发者人工清理。

人工清理旧 shared 资源时先核对 owner，再查看 Compose project、卷和 RustFS bucket 的实际名称；确认没有其他 worktree 使用后，手动停止并删除旧 Compose project 和卷，再删除旧 bucket。V3 CLI 不会替你执行这些删除。
单独启动核心应用要求当前 worktree 已执行 `pnpm dev:init -- --target core`；可选应用统一使用根入口，
例如 `pnpm dev:init -- --target ops-web`。target 会生成真实依赖的环境投影；
internal-portal-collection 和 notice-classifier 不需要再单独运行 notice-publisher 初始化。

## 可选应用

### 搜索与记忆失败边界

使用已初始化的 `test@muc.edu.cn` 开发账号登录。仅在本 worktree 的 Ops 模型配置选择 Gemini
原生 `generate_content` 及对应凭据；Hindsight 的 provider/model/endpoint/Secret 属于环境仓的
独立部署，不读取这份主模型配置，也不能借用主模型 key 修复记忆服务。

先发起真实联网问题，等待会话终态后查看 Ops 同一请求：答案和引用应保留，搜索建议不应出现；如果只有查询或
建议而没有 supports，应显示 `metadata_only`，不能把它称为“已验证引用”或“搜索无匹配”。
有 supports 时确认正文未被引用替换、来源卡为 web_page，并核对丢弃原因与实际最终来源。

验证记忆故障时，仅在本 worktree 的 Memory 服务临时设置不可达的本地 `HINDSIGHT_API_BASE_URL` 与独立测试
tenant key / owner salt，重启 Memory API 与 Worker，再请求先回忆偏好、然后检索校内资料。等待回答终态与 Memory 追加操作结束，
确认 recall failed、后续回答 completed、Memory append failed 不回滚答案、terminalFailure 为空。
这是受控的记忆不可用验收，不表示成功写入 Hindsight。结束后移除临时配置并重启普通服务。

Hindsight 部署修复应在环境仓单独处理：使用该服务自己的 Secret 验证实际 retain 与 recall，
`/models` 出现某个模型不能代替 retain 验收；不得通过切换聊天模型隐式修复记忆模型。

模型响应边界由 agent-runtime 的 Activities、domain-tools 与 runner 测试覆盖。
旧 HTTP Runtime fixture 已退役，不能再把模型地址指向该入口。

可选应用不由根 `pnpm dev` 启动，初始化仍由根 CLI 拥有：

```bash
pnpm dev:init -- --target ops-web
pnpm --filter ops-web dev:api
pnpm --filter ops-web dev:web
pnpm dev:init -- --target notice-publisher
pnpm dev:init -- --target internal-portal-collection
pnpm dev:init -- --target notice-classifier
pnpm dev:init -- --target campus-docs-index-publisher
pnpm dev:init -- --target campus-rag-index-publisher
```

`notice-publisher` target 是通知 schema/category seed 的 owner；`internal-portal-collection` 只生成
Ops Web 和采集器实际读取的环境投影，`notice-classifier` 只生成 Model Config 与分类器实际读取的环境投影。
两者都通过 readiness 检查复用统一 schema 和通知分类 seed，但不重复执行 DDL。
`ops-web` target 只组合 app-api、Model Config 服务和 Ops 自身环境，不准备通知任务、分类模型或 Dining 数据。
`notice-index-publisher` 复用 schema owner 安装数据库 baseline；`campus-docs-index-publisher` 只生成其 Docs
builder 环境；`campus-rag-index-publisher` 独立准备统一 publisher 读取 derived bucket、Qdrant 和当前索引
数据库所需的环境及统一 schema，不上传本地 `var/` 制品。

验证统一 Campus RAG 发布时，独立初始化 publisher 即可：

```bash
pnpm dev:init -- --target campus-rag-index-publisher
```

统一 publisher 的本地入口是：

```bash
pnpm --dir jobs/campus-rag-index-publisher publish-index-local -- \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

运行上述命令前，先用 `import-artifacts-local` 从集群 derived object store 导入两个 Embedding Set 的 serving
引用闭包。导入使用临时 object-store port-forward，并写入当前 worktree 的隔离本地 bucket；不会复制整个
bucket，也不会写入集群 bucket。发布验证使用本地 PostgreSQL/Qdrant 和本地 S3，不调用 embedding provider，
也不形成线上前置状态。`dev:init -- --target campus-rag-index-publisher` 独立准备所需 PostgreSQL、统一 schema、derived bucket 与 Qdrant。
环境渲染使用当前 profile 的端口和私有 key，不依赖先启动其他 target；基础设施检查再验证连接。

## Ops Web API

Ops Web 的页面和 Node API 分别启动；只验证服务端接口时，在一个终端运行：

```bash
pnpm --filter ops-web dev:api
```

另一个终端可检查进程和核心就绪边界：

```bash
curl -sS http://127.0.0.1:<ops-api-port>/healthz
curl -sS http://127.0.0.1:<ops-api-port>/readyz
```

将 `<ops-api-port>` 替换为当前 worktree profile 的本地 `PORT` 配置，或使用
`pnpm dev`/独立 API 命令输出的地址。local/development 的 `/readyz` 不要求 Cloudflare Access，但仍
要求本地公开 origin 和 Ops Web 状态数据库。自动化 origin 不影响该结果；未配置时仅自动化 token
管理区和机器接口返回 `OPS_AUTOMATION_NOT_CONFIGURED`。

本地通知任务不连接 Kubernetes。页面或 `POST /api/ops/notices/jobs` 创建任务后，Ops Web 启动当前
worktree 的固定 Job CLI，并继续通过既有任务查询接口返回 `pending`、`running`、`succeeded` 或 `failed`。
任务只保存在进程内，重启 Ops Web 后历史消失。分类任务需要根 `pnpm dev` 中的 Model Config；采集任务
需要 Ops Web 中已有可用的内部门户凭据。

需要验证真实 HTTP、Bearer、TGC 刷新和 CAS 失败语义时，使用隔离 fixture：

```bash
pnpm --filter ops-web dev:fixture
```

命令只监听 `127.0.0.1`，启动输出包含临时 endpoint、fixture token 和凭据 ID。fixture 使用内存存储
和固定测试响应，不读取真实门户凭据，也不代表 staging 或 production 状态。MCP 调用应与该进程
处于同一网络命名空间，并使用输出的 loopback endpoint。

## 独立操作与诊断

初始化的组成步骤可单独重跑：`pnpm dev:local -- env --target <target>`、`infra --target <target>` 和 `schema`。
需要 Hindsight 时先配置其独立 provider 环境变量，再运行 `pnpm dev:local -- infra --service hindsight`。
通知采集 schedule 由 pipeline owner 显式创建：先 `dev:init --target notice-pipeline-worker`，再
`pnpm dev:local -- schedule init --target notice-pipeline-worker`。artifacts worker 初始化不会调用 pipeline schedule。

`dev:doctor --target <target> --scope <scope>` 的范围如下：

| scope | 检查范围 |
| --- | --- |
| config | 当前 target 的托管环境字段、worktree 资源身份与私有模型密钥，不访问服务 |
| infra | 当前 target 的基础设施和 Temporal namespace，不检查业务数据或模型 |
| schema | 统一 schema 与 target 的必要记录 |
| data | 必须显式 `--domain`，按领域校验资源引用；retrieval 才扫描向量 |
| startup | 配置、基础设施、schema；core 额外检查 Docs 构建输入 |
| runtime | startup 所需服务、目标模型配置、进程健康；core 额外检查检索 |

旧 `dev:init --data/--replace` 参数会在创建资源前报错；初始化不再执行数据操作。只在按域替换和检索源同步时停止相关数据消费者，普通初始化和通知 upsert 不要求全体应用离线。

## Model Config

在线配置由当前 worktree 的独立 Model Config 数据库、role 和 `model-config-encryption.key` 持有。
`pnpm dev:local -- models seed --target core` 或 `--target notice-classifier` 按 target 从当前进程环境或根 `.env` 显式
seed 缺失的 Model Config；它不访问 Provider、不覆盖已有配置，也不产生 validation 记录。需要在线修改或
验证时，启动本地 `pnpm dev` 与 `pnpm --filter ops-web dev:api`、`pnpm --filter ops-web dev:web`，按
[在线模型密钥操作](./access/provider-secrets.md) 操作。应用启动不能静默 seed 在线配置。main checkout 导入的 provider 字段只是
初始化输入，不是 runtime source；映射由 target 声明的 config name 决定，通用 LLM 连接不会隐式覆盖已有
通知分类配置。`notice_classification` 本地 seed 使用独立的
`NOTICE_CLASSIFICATION_BASE_URL`、`NOTICE_CLASSIFICATION_API_KEY` 和
`NOTICE_CLASSIFICATION_MODEL` 输入；是否复用 endpoint 或凭据由调用方的本地输入决定，不把两个配置
合并，也不改变通知消费者逻辑。
Gemini 本地初始连接使用 `LLM_PROVIDER=google`、`LLM_API_PROTOCOL=google.generate_content`，以及
`LLM_BASE_URL`（包含 `/v1beta` 等原生版本路径）、`LLM_MODEL` 和 `LLM_API_KEY`。已有配置使用 Ops 的
LLM 表单选择“Gemini（原生 API）”后保存，不重跑 seed 覆盖在线配置。OpenAI / Gemini 切换只影响新请求；
不在运行中换 runner，不自动 fallback。验证时等待每个会话终态后再发送下一个问题，分别检查问候、
Campus RAG、Google Search 来源卡，以及刷新后仍不出现搜索建议；单独验证配置连接成功不能替代真实会话。

验证查询 Embedding 精确缓存时，重启当前 worktree 的 campus-search 清空进程内缓存，
使用相同的实际检索表达检查 Search 响应诊断中的 `cacheOutcome` 从 miss 变为 hit。
模型可能改写问题，因此两个相同用户问题不保证缓存命中。`estimatedSavedMs` 是避免的上游耗时估算，
不是整轮回答的实测加速；缓存命中仍须执行召回和重排，不需要重建索引。

当前 Runtime 工具适配器不转发 Search 的完整诊断快照与分阶段时间，Control HTTP 观察类型也不序列化
这些字段，因此不能以 Ops 页面验证 embedding、Qdrant 或 rerank 的完整耗时。
Search 侧验证响应与诊断，产品侧验证工具终态、答案和引用；数据缺口见
[Campus Search 合同](../contracts/campus-search.md)。同一通知的互补片段可同时返回，
最终引用与产品来源应一致。离线检索评测和真实会话分别验证各自链路。

`pnpm dev:init -- --target core` 通过 `campus-agent-schema` 为新建或重建的本地数据库安装统一 baseline。
显式模型 seed 和 runtime doctor 会检查当前 Model Config 密文可由 `model-config-encryption.key` 解密；失败说明数据库和 key 不属于
同一个本地实例。不要复制其他 worktree、staging 或 production 的 encryption key；使用
`pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>` 显式销毁该实例后重新运行
`pnpm dev:init -- --target core`，再通过 Ops Web 配置本地模型。

## 本地供应商定向直连

若本地代理拖慢某个供应商，可在当前 worktree 根 `.env` 的 `NO_PROXY` 中追加目标域名，例如
`NO_PROXY=ai.gitee.com`。这里的 `NO_PROXY` / `no_proxy` 是本地附加名单：`dev:init` 将其与初始化
进程已有的两个变量合并、去空白和重复项，生成内容一致的大小写变量，写入 agent-control、memory-service、campus-search 和
Model Config 的托管环境文件。Search 覆盖 embedding / rerank，Model Config 覆盖供应商连接校验。
没有非空本地名单时不生成覆盖值，保持启动进程的继承行为。此名单不从 main checkout 自动导入。

修改后先确认当前 bootstrap ready，再运行 `pnpm dev:init -- --target core` 并重启当前 worktree 的
agent-control、memory-service、campus-search、Model Config；已有 ready 的模型配置不会重新 seed。不要直接编辑托管 `.env.local`。
此操作不改写 `HTTP_PROXY` / `HTTPS_PROXY`，不改变 Agent Runtime 的 Gemini 网络路径，也不改线上配置。
回退时仅删除本轮追加的域名，再初始化并重启；若删除全部本地名单，重新生成会移除旧的托管覆盖值。
使用真实 RAG 会话和 Search 侧诊断确认效果，不以连接校验成功替代会话验收。

## Campus Web 浏览器回归

浏览器回归由开发者按变更涉及的边界手动选择，不进入 GitHub Actions，也不是每次修改或 agent 任务的必跑步骤。
业务状态、错误映射和请求规则由 Vitest 覆盖；浏览器保留布局、焦点、历史导航、剪贴板、流式交互和构建产物边界。

```bash
# 按变更选择文件，也可使用 --grep 选择用例
pnpm --dir apps/campus-web test:e2e e2e/dining.spec.ts
# Worker 构建产物边界或响应式布局变更时，手动选择对应套件
pnpm --dir apps/campus-web test:e2e:worker
pnpm --dir apps/campus-web test:e2e:ui-baseline
# 需要全量回归时显式执行
pnpm --dir apps/campus-web test:e2e:full
```

独立 smoke 入口已删除。单独运行各套件会自动构建；`test:e2e:full` 只构建一次，随后顺序运行
app、Worker 和 UI baseline，内部以 `CAMPUS_WEB_E2E_PREBUILT=1` 复用本次产物。手动设置该变量
仅适用于已完成构建且输入未变化的情况。app 不重复运行 UI baseline。默认使用两个 Playwright worker，
资源受限时可在单套件命令后追加 `--workers=1`。

UI baseline 按适用视口选择 36 个用例：布局覆盖 320/390/1023/1024/1440 五个宽度，
导航断点覆盖 1023/1024，通用交互覆盖 390/1440，移动端和桌面端专属行为只在对应视口执行。

需要验证真实 Campus Web Worker、真实 App API Worker、Service Binding 和本地数据库之间的聊天链路时，
显式运行：

```bash
pnpm --dir apps/campus-web test:e2e:dev:chat
```

该命令会在当前 worktree profile 的端口上启动确定性的 agent-control HTTP fixture、App API Wrangler
和 Campus Web Wrangler。fixture 只读取本地 `APP_API_INTERNAL_SHARED_SECRET`，校验 App API 冻结输入的原始
SHA-256，并在产品回调成功后发布终结事件；它不会连接 staging、Cloudflare 远端资源或真实模型。
测试覆盖本地登录、普通回答、重新生成、记忆设置路由和 `GET /api/me/profile-memory`。

这是本地用户行为和依赖协议证据，不代表 staging、production、部署控制器或真实 agent-control 已经
健康。命令结束后 Playwright 会停止本次启动的 fixture 和两个 Wrangler 进程；当前 worktree 的 Postgres、RustFS、Qdrant、Temporal 和 profile 不由该命令销毁。

Temporal 与数据库集成测试按涉及的 owner 手动选择，不要求启动完整产品服务：

```bash
pnpm --dir apps/agent-runtime test:temporal-integration
pnpm --dir apps/agent-control test:database-integration
pnpm --dir apps/memory-service test:database-integration
```

Runtime 使用测试 Temporal 环境；数据库集成使用隔离 PostgreSQL 和共享 schema，不连接 staging。
测试进程负责清理自己启动的 worker、server 和容器。旧 Go Workflow 的 Temporal、replay 和 stream
脚本已退役。

GitHub `manual-validation-profile` 可分别选择 `agent-runtime-temporal`、`agent-control-postgres`
或 `memory-postgres`；可用选项以[工作流定义](../../.github/workflows/manual-evidence.yml)为准。
这些手动集成测试不扩大默认 PR required check 范围。
