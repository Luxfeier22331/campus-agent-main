---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0064
status: superseded
superseded_by: ADR-0080
---

# ADR-0064：运行配置所有权

## 原决策

本决策区分仓库静态配置、部署 bootstrap、secret、应用运维配置和生成投影，并曾把全部模型、
embedding 与 rerank active profile 交给 app-api provider-config。

## 取代

ADR-0080 保留配置分类，但按实际消费 runtime 拆分所有权：

- execution-control 拥有在线执行 Provider Config、加密 keyring、验证和原子激活；
- Hindsight 与 eval 各自拥有内部 provider 配置；
- GitOps 与 Secret 交付启动句柄和密钥材料，不代替 runtime active state；
- app-api 不拥有 provider profile 或生成投影。

当前操作见 `docs/environment/providers.md` 和 `docs/runbooks/provider-secrets.md`。
