---
doc_type: architecture
owner_boundary: docs/architecture/system
status: active
---
# 运行时发布架构

## 文档边界

本文定义 Cloudflare Worker、Kubernetes 服务和数据库变更的发布所有权。具体环境值、操作
命令和环境交接步骤分别由环境仓、runbook 和 CI 工作流维护。

## 所有权

| 所有者 | 负责 |
| --- | --- |
| 源码仓 | 构建镜像、按目标 Worker 配置上传不可变 Cloudflare Worker 候选版本、产出 schema 和发布清单 |
| 环境仓 | 选择镜像摘要和 Cloudflare Worker 版本，维护环境配置并发起实际发布 |
| Cloudflare Terraform | Worker 绑定、域名、路由、非密配置和流量版本 |
| Argo CD | Kubernetes 资源和镜像摘要 |
| schema Job | 在依赖新结构的服务接收流量前完成数据库迁移和授权 |

源码仓产出候选物，不直接声明某个环境已经上线。环境仓选择并应用候选版本后，环境状态才
构成部署事实。

## 发布链

```text
源码 main
-> 构建不可变镜像并上传 Cloudflare Worker 候选版本
-> 从环境仓 staging 游标计算累计受影响范围
-> 环境仓滚动 PR 选择镜像摘要和 Cloudflare Worker 版本
-> 机器字段校验通过后自动合并
-> 数据库 schema 与平台配置收敛
-> Argo CD 同步 Kubernetes
-> Terraform 切换 Worker 流量
```

规则如下：

- Cloudflare Worker 候选上传使用版本接口，目标 Worker 必须已由环境仓完成首次部署；源码仓不直接
  创建 Worker、修改路由或切换流量；
- Kubernetes 使用镜像摘要，不用可变标签表达环境目标；
- 依赖新 schema 的运行时必须在迁移成功后才能接收流量；
- 删除列或收紧约束必须采用 expand/contract：先部署同时兼容新旧 schema 的运行时，确认旧版本不再
  承接流量和即时回滚后，再由后续 migration 收缩结构；
- 一个应用失败不能被其他应用的健康状态掩盖；
- 候选版本上传成功、镜像构建成功或清单渲染成功都不等于部署完成。
- 常规 staging 版本选择使用唯一滚动 PR；Secret、权限、资源、网络、Terraform、Application 拓扑和
  其他环境变化不进入自动合并。

Kubernetes 发布以实际故障域为 Application 边界。强依赖 schema 的运行时在同一 Application 内
依次同步配置、身份、所需 NetworkPolicy、migration、workload 和 schedule。身份和授权按实际
数据所有权与信任边界决定，不因进程名称自动拆分。migration 使用 `Sync` hook，并在本单元的
上述前置资源健康后执行。不同 child Application 的 wave 只帮助组织资源，不能承诺跨应用事务。

## 发布标识

每次构建必须能够关联到源码提交、镜像摘要或 Worker 版本标识。包含静态数据 release 的
Worker 还必须记录数据 release identity 和二者组合的 build identity。应用日志、观测数据和
环境仓变更应使用这些不可变标识定位同一次发布，不在源码仓中长期写死某个环境发布号。环境仓用
已选择 Source SHA 作为下一次候选计算基线；Argo CD 和 Cloudflare 状态写回该 Source SHA，分别表达
对应部署单元的结果。

`DEPLOYMENT_RELEASE` 是单个 execution runtime 的非密发布身份。execution-control 和 agent-runtime
分别记录自己的 release，允许独立发布且不要求值相同；release 只用于诊断和变更关联，不进入工具
兼容性判断。已部署进程必须取得自身的非空发布标识，不能以本地默认值或环境名称补齐。工具兼容性
只由 `tool_contract_fingerprint.v1` 判断，精确合同见 [执行合同](../../contracts/tool-execution.md)。

## 仓库正式版本

仓库使用一个手动指定的 `v0.minor.patch` 版本，从 `v0.1.0` 开始。0.x 的功能或破坏性变化递增
minor，兼容修复递增 patch；不批量改写各 package 的版本，不把版本号作为服务兼容性判断。
`main` 仍自动产生增量候选物并进入 staging。

Source 的 `formal-release` workflow 从一个已完整成功的 GitOps staging Deployment 确认正式版本。
GitOps 工具读取该 Deployment 的精确 revision，导出所有活跃第一方镜像 digest、Source base ref、
Application revision、实际 execution runtime identity、三个目标 Worker 的 `versionId/sourceSha`
以及 schema 镜像和其 producer SHA。未变化的组件保留其原始提交，不要求全部制品来自一个 SHA。

GitHub Immutable Release 的 tag 绑定 Source SHA，机器合同是随 draft 上传后一起发布锁定的
`release.json`；release notes 不参与机器决策。创建正式版本不构建、不重新上传 Worker，不依赖
七天后过期的 Actions candidate artifact。同版本同内容重复执行不重写资产，内容冲突失败。

正式版本只提供常规历史选择身份。GitOps 通过普通评审 PR 选择应用版本，保留当前平台配置、
Secret、网络和能识别已应用 migration 的 schema owner。目标 schema 依赖比当前 owner 更新或
分叉、组件拓扑不同、制品不可用或版本已退役时，普通选择失败。服务合同、数据库前后兼容和
运行中 Temporal history 由维护者结合完整 diff 与已有测试评审；不兼容时使用已有维护、排空和恢复
流程，不能将切回镜像当作撤销迁移或历史。

Cloudflare 回滚仅选择平台仍可部署的原生 version；不保存长期 Worker 构建包，不重建或重传以替代
原版本。原生回滚有最近 100 个版本与绑定/资源兼容限制；应用代码回退不回退连接资源，最终应用由
现有 traffic Terraform root 验证。仓库版本不引入 Temporal Worker Versioning，也不承诺不停机更新。

未退役正式版本、环境当前选择、最后成功部署、在途和恢复目标共同构成 GHCR 保留根；共享 digest
与 OCI 子 manifest 取并集。退役只写 GitOps 中的版本及原因，不删除、修改或复用 Release/tag。
Source 的 full report/apply 按保护根清理无引用版本，并与候选和正式版本发布串行。
定时清理在真实 workflow token 的首次删除复查通过后启用，操作见[GHCR 清理](../../runbooks/release/ghcr-retention.md)。

## 配置与密钥

- 环境仓维护可审查的非密配置和资源引用；
- 密钥由对应平台或密钥管理链路注入，不进入 Git、镜像、ConfigMap 或前端产物；
- Worker 之间通过 Service Binding 调用，内部请求地址不是公开产品地址；
- Kubernetes 服务使用集群内地址和环境仓提供的运行身份；
- 本地 `.env`、Compose 和临时隧道只服务开发，不作为环境配置来源。

## 就绪与环境交接

`/healthz` 只证明进程可以响应，`/readyz` 只证明该服务当前可以接收请求。这些接口是运行时证据，
不构成源码发布完成或环境交接完成。环境仓如需验证产品路径，按其自身手册处理；本仓库不把该验证
设为发布链的固定阶段。

## 不允许的形态

- 在源码仓用 `wrangler deploy`、回滚命令或路由配置直接改变环境流量；
- 使用可变镜像标签或手写版本字符串代替不可变发布标识；
- 让常驻应用自行执行数据库迁移；
- 在环境 overlay 中拼接数据库 URL、重写第一方命令或补齐安全上下文；
- 把 staging 域名、账号、截图或一次性检查结果写成长期架构；
- 只凭单个健康接口判断整次发布完成；
- 把本地 Compose 或源码清单当作线上环境事实。

## 相关文档

- [产品运行时](./product-runtime.md)
- [Kubernetes 运行时](./k8s-runtime.md)
- [环境配置](../../environment/README.md)
- [发布操作](../../runbooks/release/release.md)
- [GitOps](../../../.agents/notes/implemented/process/2026-07-16-gitops.md)
- [Staging 版本选择](../../../.agents/notes/implemented/process/2026-07-25-promotion.md)
