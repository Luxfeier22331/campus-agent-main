---
doc_type: index
owner_boundary: docs/product
status: active
---

# 产品需求

`docs/product/` 保存功能级 PRD 和面向上线的用户体验要求。窄能力由一篇文档同时给出必要的
用户行为、消费边界和可执行来源，不再为同一能力建立转发文档。

## 已生效需求

- [ui.md](./ui.md)：仓库内界面的信息层级、状态真实性、响应式和无障碍基线；
- [web.md](./web.md)：Campus Web 学生旅途、领域连续性和性能要求；
- [status-web.md](./status-web.md)：公共产品可用性状态与近期历史；
- [dining.md](./dining.md)：食堂地图、菜单、评价、举报与内容维护；
- [legal-consent.md](./legal-consent.md)：注册同意体验和法律页面内容；
- [run-context.md](./run-context.md)：连续追问、上一轮依据、上下文裁剪和并发轮次体验；
- [campus-ui-state.md](./campus-ui-state.md)：Campus Web 用户可见状态、恢复范围、问答过程和搜索生命周期治理；
- [ops-web.md](./ops-web.md)：自托管运行概览、运行记录、在线模型配置和内容运营。

产品边界见 [产品定位](../architecture/product.md)，当前实现从 [架构文档](../architecture/README.md) 进入最近的
系统、领域和合同所有者，wire shape 见 `docs/contracts/`。PRD 可以定义用户行为和验收标准，但不得
重新定义架构所有者、data schema 或部署 runbook。尚未接受的产品提案留在 Issue 或 Project，不进入
本目录。
