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

仓库通用入口为：

```bash
pnpm exec tsx scripts/deploy/doctor-env.ts <surface> --json
```

可用检查对象及其字段由 `scripts/deploy/doctor-env/specs.ts` 唯一维护，命令在不支持的对象上必须
失败。环境检查只读取声明的环境和配置文件，不把 schema、工具注册或 Secret 名存在推断为
运行能力。

Cloudflare Secret 存在性检查和 Worker 发布前检查由 `../runbooks/provider-secrets.md` 与发布
脚本维护，不在本文复制命令清单。

## 运行时就绪

### Execution Control

Execution Control 的 `/readyz` 只用以下核心条件决定 HTTP 状态：回答准入仍可接收请求、运行
投影可用、Temporal 及必要 task queue poller 可用、Primary Agent 配置已激活，以及 Agent
Runtime 地址已配置且其 `/readyz` 成功。Agent Runtime 的就绪探针本身不需要调用 Activity 使用的
共享密钥。

OTel exporter、工具读取投影、Hindsight 个人记忆和 Qdrant 知识检索仍作为诊断字段出现在响应
中，但它们是局部能力，不参与 Execution Control 顶层就绪判定。局部能力不可用时，由对应工具
或运行路径返回明确失败；不能让无关请求因一个局部依赖故障而失去整个服务端点。查询向量配置
由知识检索运行时自行检查，只有 Primary Agent 配置参与顶层 Provider Config gate。

非本地环境中的完整结果属于受信任机器接口，由产品后端携带内部身份读取，不直接作为公开浏览器
探针。

工具是否开放只由工具注册表、handler、合同和运行测试共同决定；环境检查不能替代工具准入。

### App API

App API 的 `/readyz` 是产品后端就绪入口，可以包含安全的 Execution Control 摘要和当前运行
版本标识。该标识必须由发布流程与环境仓选择的版本比较；旧版本即使健康，也不是目标版本已经
发布的确认结果。

App API 连接不到 Execution Control 时，只记录 `executionControl` 这一项失败；
`executionRuntime` 保持 `not_ready`，但不复制同一个网络错误。Execution Control 已响应但其核心
运行预检失败时，才由 `executionRuntime` 记录返回的具体阻断原因。

### 其他界面

Ops Web、文档阅读器和其他应用只报告各自职责范围内的就绪状态。一个界面的 `/readyz` 不代表
聊天、采集、评测或其他产品界面同时就绪。

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
