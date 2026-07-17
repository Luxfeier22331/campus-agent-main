---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---
# Kubernetes GitOps 交接

## 边界

本文说明本应用源码仓库与运维环境仓库之间的交接。所有权决策见 ADR-0074；本仓库不是任何
Kubernetes 环境的部署事实，也不保存私有 cluster coordinate、Application 名、namespace、
Helm value 或 encrypted secret inventory。

Cloudflare 由环境仓库中的 Terraform 管理，不由 Argo CD 管理。

## 仓库职责

本源码仓库负责：

- `infra/k8s/*/base` 下 namespace-neutral workload base；
- 稳定 ConfigMap/Secret consumption contract；
- first-party image build、scan 与 immutable publication；
- 不改变 traffic 的 immutable Worker version upload；
- 通过 pull request 提议 source SHA、image digest 与 Worker version 变更。

环境仓库负责：

- Argo CD Application、namespace、overlay、NetworkPolicy 与 third-party chart value；
- ConfigMap、Secret delivery、registry credential 与 trust anchor；
- 完整 source commit SHA、first-party image digest 与 runtime release id；
- Cloudflare state、Worker version selection 与 traffic；
- rollout、recovery、database/schema job 和环境验证。

不得把环境文件复制回源码仓库，也不得在源码文档复制环境仓库中的当前资源清单。

## 初次接入

1. 按环境仓库文档安装 Argo CD 与选定的 secret-delivery controller；
1. 为 source/environment repo 配置只读 Argo CD repository credential；
1. 在环境仓库提交并审查所需 secret resource，缺少依赖时 workload 不得启动；
1. 一次性创建环境 root Application；
1. 确认 root 与 child Application 已在同一环境 revision 上完成 reconcile。

具体 bootstrap 命令与 credential 形式只写在环境仓库。

## 版本提升

source `main` 的 publication workflow 构建受影响 artifact，并使用专用 GitHub App 创建或更新
幂等环境 pull request。workflow 只能修改环境仓库已经声明的 deployment input，不能直接写
环境 `main`、创建未声明 consumer 或改变 production traffic。

没有环境消费者的新镜像可以先作为不可变候选发布，但不会自动加入环境 pull request；显式
手动提升要求所有选中镜像已有完整消费者。发布候选不代表环境已部署。

环境 pull request 至少应：

- 固定完整 source commit SHA 与 image digest/Worker version；
- render 所有受影响 Kustomize/Helm/Terraform target；
- 校验 Secret 名称与 workload consumption contract；
- 清楚显示 rollout 与 traffic 影响。

合并后由 Argo CD reconcile Kubernetes，由 Terraform reconcile Cloudflare；执行顺序和 health
gate 由环境仓库拥有。

## 密钥

- workload 只依赖稳定 Secret 名与 key，不依赖某个加密工具的类型；
- plaintext、controller key、certificate、kubeconfig 与 provider credential 不进入 git；
- 使用 Sealed Secrets 时采用 strict scope，只在私有环境仓库存 ciphertext；
- Cloudflare Worker 独占的 secret 只进入 Cloudflare secret store，不镜像到 Kubernetes 或
  Terraform state；
- 验证时只检查 Secret type、key 是否存在和 workload admission，不打印 value。

`APP_API_PRODUCT_CALLBACK_SHARED_SECRET` 是跨运行时认证凭据，不是 Worker 独占 secret。
运维人员必须在可信环境生成一次，将同一个值分别投递为 Cloudflare app-api Worker secret 和
Kubernetes `execution-app-api-internal-secrets/APP_API_PRODUCT_CALLBACK_SHARED_SECRET`，并将两端
作为同一轮换单元。源码发布前置检查和 GitOps 只验证各自 key 存在；不得把任一端的值、
解密结果或同步副本写入 Git、Terraform state 或 CI 输出。

内部门户 TGC 是频繁人工轮换的短期例外：环境只预创建一次
`source-collector-internal-portal-auth`，并为 Ops Web 绑定资源名级 `get`、`patch` 权限。日常
轮换不提交新的 SealedSecret 或 Git 记录；其他凭据继续使用环境的常规投递方式。

Ops Web 只有在独立 Secret 提供 `OPS_WEB_AXIOM_QUERY_TOKEN`，且 ConfigMap 完整提供 Axiom Edge
URL、三个 dataset 和 timeout 时才启用观测查询。token 必须是限定 dataset 的 query-only token；
不得使用 Axiom personal、ingest 或 Terraform 管理 token。该 Secret 缺失只使日志和调用链
不可用，不阻塞 Ops Web readiness 或 PostgreSQL 摘要。

Collector 的四个 receiver token、Axiom 三个 ingest token、Langfuse runtime/Hindsight project
credential 必须彼此独立。workload 只消费自己端口或项目所需的 credential；不得恢复共享
Collector ingest secret、Collector Sentry credential 或旧 OpenObserve key。

execution-control `activity-core` 还必须消费一个 `LANGFUSE_MAINTENANCE_BASE_URL` 和 runtime、
Hindsight 两组 maintenance public/secret key。base URL 属于非敏感部署配置，两组 key 属于独立
project credential；它们同时服务 owner erase 与七天 Temporal retention。缺少任一项时 core
worker 应在启动时失败，不能通过禁用删除来恢复 readiness。

Cloudflare Axiom application-log destination token 只存在于受保护的 GitHub Environment，并由
环境 workflow 写入 destination header；不得进入 Terraform variable、plan、state、Kubernetes
Secret 或源码。
campus-web browser source map upload credential 同样只存在于 CI Environment，不进入 Worker。

## 可观测链路发布

可观测性变更按以下顺序拆分：

1. 先创建 Axiom dataset/retention、两个 Langfuse project、受限 token 和 Cloudflare
   application-log destination。
2. 在可信部署主机完成 strict-scope SealedSecret reseal；任何 `requires-reseal` 标记、空
   `encryptedData` 或缺少 workload 引用 key 都必须使环境 CI 失败。
3. 部署 Collector Gateway/Agent、Hindsight OTLP、execution-control、Ops Web 和 Worker log
   destination；验证未认证和交叉 receiver token 都被拒绝，并确认 Worker
   `invocation_logs=false`、native traces 关闭。
4. 运行 chat、memory retain/recall/erase 和受控错误，确认 Axiom 三类信号、两个 Langfuse
   project 与 Sentry release/source map 各自正确。
5. 连续 24 小时确认 Collector 队列不增长、没有持续发送失败、dataset 新鲜且 trace 项目不交叉。
6. 对 query、header、正文、用户标识、prompt、answer、memory 和 credential 哨兵做下游搜索；
   Axiom 与 Sentry 必须为零匹配。

Cloudflare application logs 绕过 Collector 白名单。上述哨兵失败时必须先关闭 log destination
或对应 producer 输出；Axiom 出现 invocation log/native trace 时必须按配置漂移处理，不能继续
退役门禁。请求关联证据来自 execution-control 经 Collector 写入的 runtime trace。

OpenObserve 资源删除是单独的破坏性环境变更，不得与首次 rollout、Secret reseal 或 canary
修复放在同一 pull request。只有 24 小时门禁和哨兵检查完成后才能先声明数据库 absent；数据库
与会话确认清零后，再用后续 pull request 删除 role、Secret 和独占对象存储资源。回滚不恢复
OpenObserve。

## 验证

环境合并前需要通过环境仓库拥有的 render、policy、secret 与 Terraform plan 检查。合并后至少
确认：

- Argo CD 运行的 revision 与已合并环境 commit 一致；
- 相关 Application 已 synced/healthy；
- migration/schema job 成功，runtime 使用审查过的 immutable digest；
- readiness 与目标 product smoke 通过；
- Cloudflare 选择的 Worker version 与环境 desired state 一致。

源码 CI 成功、manifest 可 render 或 image 已上传，都不能单独作为部署证据。

## 失败处理

- repository auth 失败：修复受限 GitHub App/repository credential，不增加 personal token；
- render/plan 失败：修复环境 pull request，不强制同步无效 desired state；
- Secret 失败：核对 name、namespace、scope 与 controller，不暴露 plaintext；
- migration/rollout 失败：保留旧 revision 的可恢复性，按环境 runbook 定位 dependency；
- readiness/smoke 失败：区分 source defect 与 environment defect，在对应仓库修复。

## 相关文档

- `../decisions/adr-0065-gitops.md`
- `../decisions/adr-0066-secret-delivery.md`
- `../decisions/adr-0074-repository-boundary.md`
- `../architecture/system/k8s-runtime.md`
