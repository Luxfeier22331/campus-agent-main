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
- Cloudflare Worker secret 只进入 Cloudflare secret store，不镜像到 Kubernetes 或 Terraform
  state；
- 验证时只检查 Secret type、key 是否存在和 workload admission，不打印 value。

内部门户 TGC 是频繁人工轮换的短期例外：环境只预创建一次
`source-collector-internal-portal-auth`，并为 Ops Web 绑定资源名级 `get`、`patch` 权限。日常
轮换不提交新的 SealedSecret 或 Git 记录；其他凭据继续使用环境的常规投递方式。

Ops Web 只有在 `openobserve-reader-secrets` 中存在专用读取凭据时才启用 OpenObserve 查询。
该 Secret 缺失只使日志和调用链不可用，不阻塞 Ops Web readiness 或 PostgreSQL 摘要。
不得使用 OpenObserve root 账号或占位凭据启用该能力。

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
