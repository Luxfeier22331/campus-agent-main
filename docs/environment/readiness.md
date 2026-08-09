---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# 就绪状态

## 文档边界

本文定义环境检查、`healthz`、`readyz` 和发布验收的不同含义。它不维护环境地址、路由、Secret
清单、某次部署结果或评测供应商配置。

## 四类检查

| 检查 | 回答的问题 | 不能证明 |
| --- | --- | --- |
| 环境检查 | 运行命令所需的已知配置是否存在且格式可解析 | 远端服务健康或环境已部署 |
| `/healthz` | 当前进程或 Worker 是否能响应 | 依赖可用或产品路径完整 |
| `/readyz` | 当前服务是否具备接受其职责范围内请求的核心依赖 | 新版本已发布或完整用户旅途可用 |
| 发布验收 | 环境选择的不可变版本和必要用户路径是否符合预期 | 长期稳定性或所有可选依赖健康 |

这些检查不能相互替代。配置文件存在、健康检查成功或 CI 构建完成都不等于目标环境已经运行
该版本。

## 环境检查

仓库不维护跨应用的环境变量清单或通用环境 doctor。配置要求由实际消费方维护并测试：

- TypeScript 与 Go 服务由所属配置解析器校验启动必需输入；
- Cloudflare Worker 由 Wrangler binding、vars、secrets 和所属发布脚本校验；
- Kubernetes workload 由 manifest 的 `env`、`envFrom` 和 Secret 引用声明；
- Compose 使用 `${VAR:?message}` 表示启动必需输入，使用显式默认值表示本地默认配置；
- OTel Collector 使用官方配置校验；
- 一次性命令和 Job 只在执行时校验自身参数。

同一个配置规则不得再复制到仓库级 JSON 合同。可选能力缺少配置时，应由对应路由、工具、
Activity 或 Job 返回明确错误，不得阻塞无关服务启动或顶层就绪。

Cloudflare Secret 存在性检查和 Worker 发布前检查由 `../runbooks/provider-secrets.md` 与发布
脚本维护，不在本文复制命令清单。

## 运行时就绪

### Execution Control

Execution Control 的 `/readyz` 只用以下核心条件决定 HTTP 状态：回答准入仍可接收请求、运行
投影可用、Temporal 及必要 task queue poller 可用，以及 Agent Runtime 地址已配置且其
`/readyz` 成功。Agent Runtime 的就绪探针本身不需要调用 Activity 使用的共享密钥。

响应只返回上述核心条件、运行版本和进程内执行生命周期。`/readyz` 不探测当前模型设置、OTel
exporter、工具读取投影、Hindsight 个人记忆或 Qdrant 知识检索，也不把这些局部能力建模为响应字段。
局部能力不可用时，由对应工具、Activity 或运行路径返回明确失败；不能让周期性 Kubernetes 探针
调用业务依赖或产生业务 trace。Primary Agent 所需的 agent activity worker 不可用时，会通过
Temporal 必要 poller 缺失反映为核心故障，不再复制一套模型配置就绪判定。

非本地环境中的完整结果属于受信任机器接口，由产品后端携带内部身份读取，不直接作为公开浏览器
探针。

工具是否开放只由工具注册表、handler、合同和运行测试共同决定；环境检查不能替代工具准入。

### App API

App API 的 `/readyz` 只检查自身接受产品请求所需的核心依赖，包括认证配置和产品数据库。
Execution Control、邮件、通知、Sentry、smoke 与定时清理属于独立请求路径或后台能力；它们的
配置和远端状态不参与 App API 顶层就绪。发布流程使用 Worker version、release 和环境选择确认
目标版本，不能通过 `/readyz` 推断发布完成。

### 其他界面

Campus Web 顶层 `/readyz` 只要求应用外壳、静态资产和 App API binding。公开文档已经在构建时
进入静态产物，没有独立文档运行配置或文档就绪接口；App API 暂时不可用时，已部署的 `/docs/*`
与 `/_docs/*` 仍可读取，但 Campus Web 顶层就绪仍会反映产品外壳所需的运行依赖。

Ops Web 顶层 `/readyz` 在所有环境都要求合法的公开 origin 和请求状态数据库；非 local/development
环境还要求 Cloudflare Access 验证配置，local/development 环境跳过这项检查。自动化机器入口的
`OPS_WEB_AUTOMATION_ORIGIN` 是局部能力配置，不参与顶层就绪；缺失时由自动化接口返回明确的
`OPS_AUTOMATION_NOT_CONFIGURED`。Dining、Axiom、Sentry 与被观测服务由各自页面或接口报告不可用。
采集运行时当前未部署，其本地就绪状态不属于 staging 服务健康的一部分。

一个界面的 `/readyz` 不代表聊天、文档、采集、评测或其他产品界面同时就绪。Kubernetes 对局部
能力在所属接口处理缺少配置的错误；核心数据库、服务身份和必需 worker 依赖保持非 optional，
并可直接阻止所属 workload 启动。

## 故障语义

- 缺少核心依赖时 `/readyz` 返回非成功状态，不改写为降级成功；
- 可选诊断平台或被观测服务故障不应阻止运维界面打开；
- 就绪响应只返回安全的依赖类别和原因，不泄露地址、凭据或内部载荷；
- 浏览器连接状态和上一次成功缓存不能替代当前就绪检查；
- `/readyz` 成功后仍需按变更范围执行必要的用户路径验证。

## 相关文档

- `providers.md`
- `../architecture/system/runtime-release.md`
- `../reference/verification.md`
- `../runbooks/execution.md`
- `../runbooks/e2e.md`
- `../runbooks/provider-secrets.md`
