---
doc_type: index
owner_boundary: docs/product
status: active
---

# 产品需求

`docs/product/` 保存功能级 PRD 和面向上线的用户体验要求，不保存产品定位、当前架构、
目标架构、HTTP contract、data schema、操作步骤或活动工作状态。

## 当前 PRD

- [web.md](./web.md)：Campus Web 跨页面设计、响应式、无障碍、动效和性能要求；
- [legal-consent.md](./legal-consent.md)：注册条款、隐私同意、法律页面和 sign-up admission；
- [attachments.md](./attachments.md)：会话附件提案、message context、storage 和失败关闭；
- [langfuse-evals.md](./langfuse-evals.md)：Langfuse trace、score、dataset、experiment 和 RAG
  参数评测；
- [run-context.md](./run-context.md)：run context、RAG follow-up、evidence ref reuse 和 context
  quality eval；
- [ops-web.md](./ops-web.md)：自托管运行概览、请求诊断、门户认证和食堂内容运营。

产品边界见 `docs/architecture/product.md`，当前实现见 `docs/architecture/current.md`，wire
shape 见 `docs/contracts/`。PRD 可以定义用户行为和验收标准，但不得重新定义架构所有者、
data schema 或部署 runbook。
