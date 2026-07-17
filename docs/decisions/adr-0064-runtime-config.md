---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0064
status: accepted
---

# ADR-0064：运行配置所有权

## 背景

系统横跨 Cloudflare Workers、自托管执行服务、Temporal、Kubernetes、provider profile 和评测
artifact。把所有值都视为环境变量，会让本地、staging、Worker secret 和应用配置产生多套真相。

需要明确配置类别和所有者，同时避免部署工具成为业务配置平台。

## 决策

运行配置分为五类：

1. `repo_static_config`：工具 schema、Kustomize base、Wrangler 配置和策略 JSON；
2. `deploy_bootstrap_config`：服务 URL、namespace、runtime config path 等非敏感启动句柄；
3. `secret_material`：credential、token、DSN 和共享 secret；
4. `app_operational_config`：由所属应用控制面修改的业务/运维状态，例如 provider profile；
5. `generated_runtime_projection`：所有者服务导出的受控 runtime artifact。

Ops Web Provider Config 是外部模型、embedding 和 rerank 决策的唯一所有者。固定 Kubernetes
Secret 或本地原子文件中的 `provider_config_projection.v2` 是 active profile 真相；ConfigMap、
Helm value、Worker var/secret 和普通 `.env` 不能成为第二份 active truth。

采用平台原生交付：

- Kubernetes ConfigMap：非敏感 bootstrap；
- Kubernetes Secret/External Secrets：secret material；
- Cloudflare version var 与 Worker secret store：Worker 启动配置和 secret；
- Docker Compose env/secret：本地 bootstrap；
- Ops Web Provider Config：应用级 provider 决策、验证和发布；
- 显式生成的 projection：向不能直连所有者的 runtime 交付受控快照。

仓库只维护跨平台合同和漂移检查，不建设自研配置平台。

## 后果

- 本地与 Kubernetes 使用同一 v2 projection 合同，不维护 seed 或手工同步；
- staging/production 不得从复制的 `.env` 直接生成 desired-state ConfigMap/Secret；
- GitOps 只对账部署资源，不反向修改 provider profile；
- runtime 不得把 local-only `.env` 或 `.dev.vars` 声称为部署事实；
- provider profile 变更必须经过 Ops Web 的验证、操作者记录和 CAS 激活流程。

## 否决方案

- **全部放入 Helm/Kubernetes**：会让部署模板拥有业务 provider 真相；
- **每个 runtime 维护 env 合同**：继续保留多份漂移来源；
- **自研 env registry/config platform**：没有必要，平台原生能力已经足够；
- **provider profile 放入 Worker secret**：Worker secret store 不具备 profile 验证、操作者和激活语义。
