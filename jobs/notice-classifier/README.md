# 通知分类 Job

该包提供通知分类的一次性在线 Job。它读取 source bucket 中具有 `schema_version`、`notice_id` 和
`notice_title` 的通知来源，只把 `notice_title` 交给当前模型，并把单通知分类制品写入 derived bucket。
它不是常驻 Worker，不清洗正文、读取门户栏目、不访问 PostgreSQL，也不触发 publisher。来源对象的完整
门户合同仍由 internal-portal-collection 和 notice-publisher 各自负责；分类入口不依赖正文或其他门户
metadata。

## 输入与输出

来源对象使用固定键：

```text
internal_portal/notices/<notice-id>.json
```

分类制品使用固定键：

```text
notices/classifications/<notice-id>.json
```

制品合同为 `notice_classification.v1`，只包含 `notice_id`、`category` 和 `schema_version`。默认运行会
扫描全部来源通知并跳过已经通过合同校验的制品；缺失或无效制品会重新处理。传入一个或多个
`--notice-id` 时只处理指定通知，即使已有合法制品也会重分类。

```bash
node jobs/notice-classifier/dist/cli.js
node jobs/notice-classifier/dist/cli.js \
  --concurrency 2 \
  --notice-id 123456
```

默认并发为 2。单条通知最多尝试三次，临时 provider 错误和非法结构化输出使用有限重试；三次仍失败时
进程以非零状态退出并停止继续调度新的通知。已经完成写入的在途制品会保留，重跑时按幂等规则跳过。

## 模型配置

在线 Job 启动分类阶段后，从 `execution-control-provider-snapshot:8002` 读取一次
`notice_classifier_provider_snapshot.v1`。Base URL、API key、模型名和 transport 由 Ops Web 的通知分类
模型设置管理；Job 不接收独立的模型 Secret，也不在源码中固定某个 provider 或模型。快照只在本次进程
内存中使用，不写入对象存储或日志。

模型请求只包含标题：

```json
{"notice_title":"通知标题"}
```

当前实现支持 Responses 和 Chat Completions 两种 transport，均要求结构化的单分类输出。

## 本地对应入口

`pnpm notice:classify:job:local` 使用同一个 Job 实现和本地 RustFS 对象存储，模拟在线 Job 的来源读取、
制品跳过和模型快照行为。它从本地端口转发的 execution-control 快照读取当前通知分类连接，不读取独立
模型环境变量；本地 `.env.local` 只保存对象存储连接。

`pnpm notice:classify` 是保留给 JSONL stdout 交接和离线模型比较的显式命令，连接由调用进程显式提供，
不代表在线 Job 的配置路径。生产形态的本地验证应使用 `notice:classify:job:local`。

两条入口都只把 `notice_title` 交给模型，不消费正文、门户栏目或其他 metadata；JSONL 命令不写 derived
分类制品，本地 Job 模拟入口会写入本地 derived bucket。

### 本地对象存储 Job 模拟

`pnpm notice:classify:job:local` 使用同一个 Job 实现和本地 RustFS 模拟在线对象存储路径。`pnpm dev:init`
会为 notice-classifier 目录生成受管的 `.env.local`，其中只有 source/derived bucket 和 RustFS 连接。先
将集群 snapshot 服务转发到本地：

```bash
kubectl port-forward svc/execution-control-provider-snapshot 18002:8002

pnpm notice:classify:job:local \
  --notice-id 123456 \
  --concurrency 2
```

该入口把分类制品写入当前 worktree 的 derived bucket，并通过 port-forward 读取一次 execution-control
快照。重复默认扫描可验证合法制品跳过；使用 `--notice-id` 可验证强制重分类。API key 不写入本地受管
环境文件、制品或输出。

## Kubernetes 模板

`infra/k8s/ingestion-runtime/base/runtime/notice-classifier.yaml` 提供一个默认
`suspend: true` 的 CronJob 模板，仅用于人工创建一次性 Job，不启用自动调度。模板复用已有 source/derived
对象存储 Secret，不增加数据库、角色或分类器专用 Secret。实际启用前仍需在所属环境确认 Job 到
execution-control 快照端口的连通性；本仓库不把该环境事实伪装成源码验证结果。

## 验证

```bash
pnpm --filter notice-classifier typecheck
pnpm --filter notice-classifier test
pnpm --filter notice-classifier build
```
