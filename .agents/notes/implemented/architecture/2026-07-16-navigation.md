# Agent Note: 导航边界

Status: implemented

## 背景

校园地点和路线需要结构化空间事实，不能由通用文档检索猜测，也不能由浏览器地图供应商
拥有。

## 决策

navigation 是独立的未来领域，不属于机构知识检索。仓库拥有权威校园地点与路线事实；
外部地图供应商只能提供可替换的 geocoding、display 或 secondary-route adapter。

用户提供的位置是 request-scoped input。原始坐标不得成为 identity、authorization 或
long-term memory。确有交互需要时，后续会话可以保留粗粒度 canonical place reference。

place alias 在 navigation domain 内解析到 canonical entity。位置有歧义时必须澄清，不能
使用 top-one 猜测。

浏览器地图只是展示界面，不是 navigation tool，也不维护路线数据。
provider id 和 map SDK type 不得进入共享合同。

当前仓库只有 place catalog 和浏览器地图读取，没有 model-visible place/navigation tool、
route graph 或 route planner。未来工具必须有明确运行时、严格 request/result schema、
已开放空间数据和 evaluation coverage；现有 catalog 不预留或开放该工具。

## 未采用方案

- **让通用文档检索或模型猜测路线**：无需先建设空间数据，但不能提供可靠的权威地点与路线事实。
- **让地图供应商拥有地点身份与路线合同**：可直接复用供应商模型，但会把校园事实绑定到可替换 adapter。

## 后果

- 浏览器 place lookup 可以早于聊天导航存在。
- 缺少可靠路线数据时不得回退到模型生成路径。
- 新增工具后，地图和工具必须共享 canonical place id。
- 真实 route graph 出现前，route planning 不在范围内。

## 相关文档

- [校园地点](../../../../docs/domains/place.md)
- [校园地图渲染](./2026-07-16-map-provider.md)
- [实体别名](./2026-07-16-entity-aliases.md)
