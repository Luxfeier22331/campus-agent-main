---
doc_type: index
owner_boundary: docs/product
status: active
---

# 产品需求

`docs/product/` 保存功能级 PRD 和面向上线的用户体验要求，不保存产品定位、当前架构、
目标架构、HTTP contract、data schema、操作步骤或活动工作状态。

## 已生效需求

- [web.md](./web.md)：Campus Web 跨页面设计、响应式、无障碍、动效和性能要求；
- [dining.md](./dining.md)：食堂地图、档口、菜品、搜索和评价体验；
- [legal-consent.md](./legal-consent.md)：注册同意体验和法律页面内容；
- [run-context.md](./run-context.md)：连续追问、上一轮依据、上下文裁剪和并发轮次体验；
- [ops-web.md](./ops-web.md)：自托管运行概览、请求诊断、门户认证和食堂内容运营。

## 拟议需求

- [attachments.md](./attachments.md)：尚未开放的对话图片和文档附件体验。

产品边界见 `docs/architecture/product.md`，当前实现见 `docs/architecture/current.md`，wire
shape 见 `docs/contracts/`。PRD 可以定义用户行为和验收标准，但不得重新定义架构所有者、
data schema 或部署 runbook。
