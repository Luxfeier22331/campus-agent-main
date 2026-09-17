---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发使用 `infra/local/docker-compose.dev.yml` 提供共享 PostgreSQL、RustFS 和 Temporal；仓库不在
Kubernetes/GitOps 之外维护第二套 staging 生命周期。`docker-compose.execution-runtime.yml` 只用于按需
启动 Hindsight 与 OTel 诊断依赖。

未配置 Hindsight 时，execution-control 不向模型暴露 `personal_memory_recall`，普通对话仍使用真实
模型链路；验证个人记忆时再显式启动并配置 Hindsight。

产品页面本地开发使用 worktree profile 和应用本地托管环境文件，不读取根 `.env`。仓库生成 loopback
数据库凭据和应用本地随机 secret；linked worktree 的 target 按 projection 白名单补充尚未存在的 provider
外部开发连接，并在 `internal-portal-collection` projection 下首次导入 main 已有的门户 TGC。数据库、
对象存储资源、应用内部 secret 和 provider 配置加密 key 仍按 worktree 独立。其他外部凭据由开发者进程环境显式提供。

默认诊断 compose 使用 debug OTel Collector。只有验证本地 Agent trace 到 Langfuse 的转发时加入
`docker-compose.execution-runtime.langfuse.yml`。

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
pnpm --dir apps/campus-web build:test
pnpm dev:shared-reconcile
pnpm dev:init -- --target core
pnpm dev
```

`build:test` 只供浏览器回归使用确定性测试内容。Campus Web 的正常开发和构建读取对象存储固定键
`campus-docs/source.json`。共享依赖只由 canonical checkout 的 `pnpm dev:shared-reconcile` 供应；
`pnpm dev:init -- --target core` 为当前 worktree 创建实例资源，在来源键缺失时写入确定性开发样例，

并安装核心 schema/seed 和 Temporal namespace。`pnpm dev` 随后只读取就绪状态，并由 Turbo 并行启动
Campus Web、app-api、execution-control 和 agent-runtime。它不隐式执行初始化、迁移或 seed。
直接执行 `pnpm --dir apps/campus-web build` 也会读取当前 worktree 的托管配置。只有显式访问其他对象
存储时才通过 `env/commands/campus-docs-source.env` 或进程环境覆盖，进程环境优先级最高。

文档准备进程读取对象存储配置并生成按来源摘要命名的本地目录；随后启动的 Vite 进程只接收该目录、
构建目标和页面运行所需配置，不接收对象存储凭据。没有对象存储访问时，应使用 `build:test` 和
Worker fixture 检查，不要把测试环境改成读取远端文档。

真实流式验收先确认进程已加载当前源码：Agent Runtime 的本地 Node 进程和 Execution Control 的
Go 进程需要显式重启。使用已初始化的开发账号发起会话，等待产品终态后再提交下一轮，不把手动
取消当作正常收尾的验证。检查页面文本增长、`request.completed` 和持久状态；客户端计时上报
返回 204 只说明接收成功，还应确认两项值同起点、首渲染不早于首 delta，并且不会阻断终态。

### 模型输出格式失败验收

先用普通服务验证真实检索、回答和通知链接。需要稳定触发格式失败时，等待当前请求结束并停止当前
worktree 的普通 Agent Runtime，在 `apps/agent-runtime` 目录启动本地专用 fixture：

```bash
pnpm exec node --env-file-if-exists=.env.local --experimental-strip-types \
  --network-family-autoselection-attempt-timeout=2000 test/fixtures/model-output-failure-server.ts
```

fixture 仍调用配置中的真实模型和工具，只在 `citationStart >= 2` 且当前 Executor 已成功调用
`campus_search` 时，一次性把它的终端可见输出替换成明确标记的非法 JSON。通过已初始化账号发起
两个依赖检索步骤；只有日志出现 `test.model_output_replaced` 才算命中，Solve 直接回答不算。
等待请求终态，检查失败步骤保留 `model_output_invalid`、检索材料能继续供合成使用、Ops
“模型输出诊断”能展开看到替换文本，以及通知链接可打开。最终请求可以成功，失败步骤不能改成成功。

诊断正文仅在 `agent_step_results.model_output_diagnostic_json`，不应出现在 invocation receipt、
不可变业务 payload 或 Temporal Activity output；未记录诊断不能解释成模型输出为空。
这属于受控故障验收，不代表真实模型产生了该非法文本。结束后停止 fixture，恢复
`pnpm --dir apps/agent-runtime dev`，再用普通会话确认服务已恢复。

初始化失败时运行：

```bash
pnpm dev:doctor
pnpm dev:instances
```

`pnpm dev:doctor` 默认检查当前 target 的配置、实例资源和 owner readiness；使用
`pnpm dev:doctor -- --scope shared` 才检查共享容器运行状态、健康检查、Compose 配置 hash、网络、数据
卷和共享 bucket，`--scope runtime` 还检查当前 target 的 HTTP health endpoint。无法探测时显示 `unknown`，
不会把连接失败当成资源不存在。主 checkout 负责首次启动或重新协调共享容器，linked worktree 只复用
ready 状态的共享依赖。Temporal namespace 按 profile 创建；实例的 derived bucket 只在 target 声明需要时
供应，notice-classifier 等 database-only target 不会无条件创建它。

`pnpm dev:instances` 是 metadata-only 清单，只读取注册表，不访问 PostgreSQL、RustFS 或 Temporal；
`pnpm dev:instances -- --verify` 才为每条记录探测 worktree、database、derived bucket 和 namespace。
默认清单中的记录显示为 `registered` 或 `stale`，验证清单显示 `ready`、`stale`、`partial`、`unprovisioned` 或
`unknown`。worktree 已删除但资源仍存在时只标记
为 `stale`，不会自动清理。先用 `pnpm dev:prune` 列出 stale 记录，再确认单个实例 ID 后执行：

```bash
pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>
```

删除 linked worktree 前，先运行上述销毁命令；不要在任一 worktree 执行共享 compose 的 `down` 或
`down -v`。source bucket 与 Campus Web 文档 bucket 是共享资源，不能作为单个实例销毁目标。
单独启动核心应用要求当前 worktree 已执行 `pnpm dev:init -- --target core`；可选应用统一使用根入口，
例如 `pnpm dev:init -- --target ops-web`。target 会生成真实依赖的环境投影；
internal-portal-collection 和 notice-classifier 不需要再单独运行 notice-publisher 初始化。

## 可选应用

### 搜索与记忆失败边界

使用已初始化的 `test@muc.edu.cn` 开发账号登录。仅在本 worktree 的 Ops 模型配置选择 Gemini
原生 `generate_content` 及对应凭据；Hindsight 的 provider/model/endpoint/Secret 属于环境仓的
独立部署，不读取这份主模型配置，也不能借用主模型 key 修复记忆服务。

先发起真实联网问题，等待会话终态后查看 Ops 同一请求：答案和搜索建议应保留；如果只有查询或
建议而没有 supports，应显示 `metadata_only`，不能把它称为“已验证引用”或“搜索无匹配”。
有 supports 时确认正文未被引用替换、来源卡为 web_page，并核对丢弃原因与实际最终来源。

验证记忆故障时，仅在本 worktree 临时设置不可达的本地 `HINDSIGHT_API_BASE_URL` 与独立测试
tenant key / owner salt，重启服务，再请求先回忆偏好、然后检索校内资料。等待回答及 append 阶段
结束，确认 recall failed、后续回答 completed、append failed 不回滚答案、terminalFailure 为空。
这是受控的记忆不可用验收，不表示成功写入 Hindsight。结束后移除临时配置并重启普通服务。

Hindsight 部署修复应在环境仓单独处理：使用该服务自己的 Secret 验证实际 retain 与 recall，
`/models` 出现某个模型不能代替 retain 验收；不得通过切换聊天模型隐式修复记忆模型。

网关无法稳定返回 supports 时，显式启动 `apps/agent-runtime/test/fixtures/search-boundaries-server.ts`
补充受控端到端测试。启动方式与上面的格式错误 fixture 相同，必须监听 loopback；普通请求仍用
真实 provider。分别在新会话发送 `[smoke:grounding]` 和 `[smoke:contract-failure]`：前者应保留
正文、两个明确标记的测试来源与搜索建议，Ops 显示转换 2、丢弃 1；后者应产生失败终态与可见原因。
这只验证供应商响应之后的真实传输、Temporal、数据库与 UI，不代表真实搜索结果。结束后恢复
普通 Runtime 和连接地址，不保留测试入口在线。

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
pnpm dev:init -- --target notice-index-publisher
```

`notice-publisher` target 是通知 schema/category seed 的 owner；`internal-portal-collection` 只生成
Ops Web 和采集器实际读取的环境投影，`notice-classifier` 只生成 Model Config 与分类器实际读取的环境投影。
两者都通过 readiness 检查复用统一 schema 和通知分类 seed，但不重复执行 DDL。
`ops-web` target 额外生成全部本地通知 Job 环境，并补齐分类模型与 Dining 基线。
`notice-index-publisher` 复用 schema owner 安装数据库 baseline；`campus-docs-index-publisher` 只生成其 Docs
builder 环境；`campus-rag-index-publisher` 只生成统一 publisher 读取 derived bucket、Qdrant 和当前索引
数据库所需的环境，不上传本地 `var/` 制品。

验证统一 Campus RAG 发布时，除 `campus-rag-index-publisher` 环境外还需要同一 worktree 的 schema baseline：

```bash
pnpm dev:init -- --target campus-rag-index-publisher
pnpm dev:init -- --target notice-index-publisher
```

统一 publisher 的本地入口是：

```bash
pnpm --dir jobs/campus-rag-index-publisher publish-index-local -- \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

运行上述命令前，先用 `import-artifacts-local` 从集群 derived object store 导入两个 Embedding Set 的 serving
引用闭包。导入使用临时 object-store port-forward，并写入当前 worktree 的隔离本地 bucket；不会复制整个
bucket，也不会写入共享 bucket。发布验证使用本地 PostgreSQL/Qdrant 和本地 S3，不调用 embedding provider，
也不形成线上前置状态。`dev:init -- --target campus-rag-index-publisher` 从正在运行的本地 Qdrant Compose
容器读取 writer key 和 HTTP 映射端口，经认证检查后写入本 worktree 的托管环境文件。容器需先由
`infra/local/docker-compose.qdrant.yml` 启动；连接或认证失败时初始化报错，凭据变化后重跑初始化即可更新。

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

## Model Config

在线配置由当前 worktree 的独立 Model Config 数据库、role 和 `model-config-encryption.key` 持有。
`pnpm dev:init -- --target core` 或 `--target notice-classifier` 会按 target 从当前进程环境或根 `.env` 显式
seed 缺失的 Model Config；它不访问 Provider、不覆盖已有配置，也不产生 validation 记录。需要在线修改或
验证时，启动本地 `pnpm dev` 与 `pnpm --filter ops-web dev:api`、`pnpm --filter ops-web dev:web`，按
[在线模型密钥操作](./provider-secrets.md) 操作。应用启动不能静默 seed 在线配置。main checkout 导入的 provider 字段只是
初始化输入，不是 runtime source；映射由 target 声明的 config name 决定，通用 LLM 连接不会隐式覆盖已有
通知分类配置。`notice_classification` 本地 seed 使用独立的
`NOTICE_CLASSIFICATION_BASE_URL`、`NOTICE_CLASSIFICATION_API_KEY` 和
`NOTICE_CLASSIFICATION_MODEL` 输入；是否复用 endpoint 或凭据由调用方的本地输入决定，不把两个配置
合并，也不改变通知消费者逻辑。
Gemini 本地初始连接使用 `LLM_PROVIDER=google`、`LLM_API_PROTOCOL=google.generate_content`，以及
`LLM_BASE_URL`（包含 `/v1beta` 等原生版本路径）、`LLM_MODEL` 和 `LLM_API_KEY`。已有配置使用 Ops 的
LLM 表单选择“Gemini（原生 API）”后保存，不重跑 seed 覆盖在线配置。OpenAI / Gemini 切换只影响新请求；
不在运行中换 runner，不自动 fallback。验证时等待每个会话终态后再发送下一个问题，分别检查问候、
Campus RAG、Google Search 来源卡及刷新后的搜索建议；单独验证配置连接成功不能替代真实会话。

验证查询 Embedding 精确缓存时，重启当前 worktree 的 execution-control 清空进程内缓存，再用已有
开发账号发起两个独立的相同问题会话，每个都等待终态。核对 Ops 中实际 `effectiveQuery` 相同
（模型可能改写同一个问题，因此“用户问题相同”不保证 hit），以及 Ops Campus Search 诊断中的
cacheOutcome 从 miss 变为 hit。hit 的 estimatedSavedMs 是避免的上游耗时估算，不是整轮
回答的实测加速。对照 Ops 的 embedding、retrieval 和 rerank 耗时与返回候选，确认第二次仍执行召回
和排序；答案措辞可变化，但引用必须来自本轮检索。不要为验证缓存重建索引或重新注册账号。

Campus Search v2 实际验收需要完整跑通已有账号发问、工具完成、Ops 请求详情和引用通知详情：
核对诊断完整性与调用结果分开展示，实际模型和 collection 不被 DTO 丢弃，Qdrant HTTP/server/
decode/postprocess 可区分；已知同通知多块候选在分组后仅返回一块，排除原因可见，最终引用数与
产品来源一致。先等待会话结束再发下一题。离线标注评测与真实会话各验证自己的链路，不能互相替代。
schema 0008 只清除旧诊断；先停止本 worktree 的旧 execution-control，执行统一 schema migration，
再启动新版与 Ops API。不要在仍有旧生产者的 staging 单独提前应用这次硬切。
`pnpm dev:init -- --target core` 通过 `campus-agent-schema` 为新建或重建的本地数据库安装统一 baseline。
启动前会在 seed 后检查当前 Model Config 密文可由 `model-config-encryption.key` 解密；失败说明数据库和 key 不属于
同一个本地实例。不要复制其他 worktree、staging 或 production 的 encryption key；使用
`pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>` 显式销毁该实例后重新运行
`pnpm dev:init -- --target core`，再通过 Ops Web 配置本地模型。

## 本地供应商定向直连

若本地代理拖慢某个供应商，可在当前 worktree 根 `.env` 的 `NO_PROXY` 中追加目标域名，例如
`NO_PROXY=ai.gitee.com`。这里的 `NO_PROXY` / `no_proxy` 是本地附加名单：`dev:init` 将其与初始化
进程已有的两个变量合并、去空白和重复项，生成内容一致的大小写变量，仅写入 Execution Control 和
Model Config 的托管环境文件。前者覆盖 embedding / rerank，后者覆盖供应商连接校验。
没有非空本地名单时不生成覆盖值，保持启动进程的继承行为。此名单不从 main checkout 自动导入。

修改后先确认当前 bootstrap ready，再运行 `pnpm dev:init -- --target core` 并重启当前 worktree 的
Execution Control、Model Config；已有 ready 的模型配置不会重新 seed。不要直接编辑托管 `.env.local`。
此操作不改写 `HTTP_PROXY` / `HTTPS_PROXY`，不改变 Agent Runtime 的 Gemini 网络路径，也不改线上配置。
回退时仅删除本轮追加的域名，再初始化并重启；若删除全部本地名单，重新生成会移除旧的托管覆盖值。
使用真实 RAG 会话和 Ops 分阶段耗时确认效果，不以连接校验成功替代会话验收。

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

该命令会在当前 worktree profile 的端口上启动确定性的 execution-control HTTP fixture、App API Wrangler
和 Campus Web Wrangler。fixture 只读取本地 `APP_API_EXECUTION_SHARED_SECRET`，校验 App API 冻结输入的原始
SHA-256，并在产品回调成功后发布终结事件；它不会连接 staging、Cloudflare 远端资源或真实模型。
测试覆盖本地登录、普通回答、重新生成、记忆设置路由和 `GET /api/me/profile-memory`。

这是本地用户行为和依赖协议证据，不代表 staging、production、部署控制器或真实 execution-control 已经
健康。命令结束后 Playwright 会停止本次启动的 fixture 和两个 Wrangler 进程；共享本地 Postgres、RustFS
和 worktree profile 不由该命令销毁。

Temporal 集成测试按需在本地执行。测试会启动 Temporal Dev Server，不连接 staging 或其他部署环境：

```bash
go -C apps/execution-control test -tags=temporal_integration ./integration/temporal ./integration/execution_http -count=1 -timeout=2m
```

专项验证通过独立入口执行：

```bash
pnpm --dir apps/execution-control test:temporal-replay
pnpm --dir apps/execution-control test:stream-integration
pnpm --dir apps/execution-control test:database-integration
```

replay 只读取已提交 history；stream 只启动测试自己的 SSE HTTP server；database 使用现有
testcontainers PostgreSQL 和共享 schema job。这些命令均不要求启动完整产品服务。

Temporal 每个包进程只启动一个 Dev Server，worker 按测试清理。fixture 在 `go test -timeout` 前
预留关闭时间，失败和超时路径由子进程测试验证。SSE server 由测试关闭，PostgreSQL 容器由
testcontainers cleanup 回收。

GitHub `manual-validation-profile` 可分别选择 `execution-control-temporal`、`execution-control-stream`、
`execution-control-replay` 或 `execution-control-postgres`。默认 PR 只自动运行受影响的 native 检查；
这些服务集成和 history 验证不扩大 required check 范围。
