---
doc_type: runbook
owner_boundary: execution-control
status: active
---

# 执行服务运维

## 边界

staging execution runtime 由 Kubernetes/GitOps 管理，Docker Compose 只用于本地诊断。环境仓
拥有 Application、namespace、rollout、恢复步骤和集群证据；本文只定义源码侧交接和最低证据。

## 部署交接

1. source workflow 发布受影响的不可变 ARM64 runtime image；已有环境消费者的镜像进入环境
   PR，新镜像可以先发布候选版本再声明首个消费者；
2. 环境 CI 渲染并校验 Application、value、overlay 和加密 secret；
3. 合并环境 PR 选择 deployment revision；
4. Argo CD 按该 revision 对账。

环境 overlay 在 first-party Deployment 前运行 `PreSync` schema Job。Job 必须使用相同
execution-control image digest，安装并验证 run projection schema；长期进程保持
`EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE=false`。

最低部署证据：

- 环境仓 commit；
- root/child Application sync 与 health；
- schema Job 返回 `passed=true`、`schema_ready=true`、`store=postgres`；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## 配置和 Secret

非敏感 runtime config 由环境仓 ConfigMap 提供，secret 由环境选择的 secret backend 注入。私有
registry 的 pull secret 由环境 overlay 绑定到 first-party ServiceAccount。

在线 Provider Config 由 execution-control 管理。runtime 使用 reader DSN 与版本化 keyring，
独立 admin 服务使用 admin DSN 和 read/command token；缺少 required role、数据库或可解密 key
都是部署阻塞项。Hindsight 与 eval provider 配置不进入在线 bundle。

## 健康与排查

公开入口最低检查：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/readyz
```

execution-control readiness 降级时，根据返回信息定位 Temporal、Hindsight、Qdrant、OTel、
PostgreSQL 或 first-party runtime Application。通过环境仓修复 desired state，不恢复 Docker
staging 脚本、临时 env renderer 或宿主机直接修改。

相关入口：`../architecture/system/k8s-runtime.md`、`gitops.md`、`execution-smoke.md`。
