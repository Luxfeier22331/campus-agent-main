---
doc_type: architecture
owner_boundary: docs/architecture/system
status: active
---
# 运行时发布架构

## 文档边界

本文定义 Cloudflare Worker、Kubernetes 服务和数据库变更的发布所有权。具体环境值、操作
命令和验收步骤分别由环境仓、runbook 和 CI 工作流维护。

## 所有权

| 所有者 | 负责 |
| --- | --- |
| 源码仓 | 构建镜像、上传不可变 Worker 候选版本、产出 schema 和环境无关清单 |
| 环境仓 | 选择镜像摘要和 Worker 版本，维护环境配置并发起实际发布 |
| Cloudflare Terraform | Worker 绑定、域名、路由、非密配置和流量版本 |
| Argo CD | Kubernetes 资源和镜像摘要 |
| schema Job | 在依赖新结构的服务接收流量前完成数据库迁移和授权 |

源码仓产出候选物，不直接声明某个环境已经上线。环境仓选择并应用候选版本后，环境状态才
构成部署事实。

## 发布链

```text
源码 main
-> 构建不可变镜像并上传 Worker 候选版本
-> 环境仓 PR 选择镜像摘要和 Worker 版本
-> 数据库 schema 与平台配置收敛
-> Argo CD 同步 Kubernetes
-> Terraform 切换 Worker 流量
-> 产品入口和依赖就绪检查
```

规则如下：

- Worker 上传使用版本接口，不在源码仓直接修改路由或流量；
- Kubernetes 使用镜像摘要，不用可变标签表达环境目标；
- 依赖新 schema 的运行时必须在迁移成功后才能接收流量；
- 一个应用失败不能被其他应用的健康状态掩盖；
- 候选版本上传成功、镜像构建成功或清单渲染成功都不等于部署完成。

Kubernetes 发布以实际故障域为 Application 边界。强依赖 schema 的运行时在同一 Application 内
依次同步配置与身份、数据库角色、migration、workload 和 schedule。嵌入宿主的可选领域能力可以由
独立 Application 拥有 schema、专用角色和授权，宿主必须通过 optional 引用局部降级。migration 使用
`Sync` hook，并在本单元的 Secret 与 DatabaseRole 健康后执行。不同 child Application 的 wave 只帮助
组织资源，不能承诺跨应用事务。

## 发布标识

每次构建必须能够关联到源码提交、镜像摘要或 Worker 版本标识。包含静态数据 release 的
Worker 还必须记录数据 release identity 和二者组合的 build identity。应用日志、观测数据和
环境仓变更应使用这些不可变标识定位同一次发布，不在源码仓中长期写死某个环境发布号。

## 配置与密钥

- 环境仓维护可审查的非密配置和资源引用；
- 密钥由对应平台或密钥管理链路注入，不进入 Git、镜像、ConfigMap 或前端产物；
- Worker 之间通过 Service Binding 调用，内部请求地址不是公开产品地址；
- Kubernetes 服务使用集群内地址和最小权限身份；
- 本地 `.env`、Compose 和临时隧道只服务开发，不作为环境配置来源。

## 就绪与验收

`/healthz` 只证明进程可以响应，`/readyz` 只证明该服务当前可以接收请求。发布验收还必须
确认环境仓选择的版本已经生效，并从实际产品入口验证受影响路径。完整命令和检查范围见
runbook，不在架构文档保存某次验收输出。

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
- [发布操作](../../runbooks/release.md)
- [ADR-0065](../../decisions/adr-0065-gitops.md)
- [ADR-0078](../../decisions/adr-0078-worker-versioning.md)
