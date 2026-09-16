# Agent Note: 校园地图渲染

Status: implemented

## 背景

浏览器地图需要 renderer，但校园地理事实不能交给商业地图 API、公共 OpenStreetMap 服务
或供应商 schema 拥有。

## 决策

Campus Web 使用 MapLibre GL JS 渲染当前校园地图。MapLibre 只是浏览器 renderer，以
self-hosted vendor asset 交付，不定义 place 或 route contract。

当前地图使用经评审的校园 GeoJSON 和 place projection，由 Campus Web 的 manifest、摘要资产与
地点目录统一提供，不依赖外部 basemap、geocoder 或 route provider。Campus Web 同时拥有静态
资产和版本选择；App API 不参与地图读取。

production 路径不得依赖 OpenStreetMap Foundation 公共 tile 或 Nominatim endpoint。
以后如有明确的显示、geocoding 或校外需求，可以增加商业或政府地图供应商，但它仍是
adapter，且必须满足地图与数据规则。本笔记 不预选供应商。

renderer delivery、lazy loading 和 bundle budget 属于前端实现。替换 MapLibre 需要明确的
产品或迁移理由；默认不自研地图 renderer。

当前地图支持 place browsing，不支持 route planning。route overlay 必须等待 [导航边界](./2026-07-16-navigation.md) 的
navigation data 和 contract。

## 未采用方案

- **直接依赖公共 OSM tile 或 Nominatim 服务**：可快速接入地图与地理编码，但不是本决策接受的
  production 依赖；当前只需要已评审校园数据的浏览器展示。
- **自研地图 renderer**：可完全控制渲染，但原记录未给出替换 MapLibre 所需的产品或迁移理由。

## 后果

- 校园 GeoJSON 和 canonical place id 保持供应商无关。
- 公共 OSM endpoint 不是隐式 production dependency。
- renderer 或 provider 变化不能改写校园地点 identity。
- 地图可用不代表 model-visible navigation tool 已存在。

## 相关文档

- [导航边界](./2026-07-16-navigation.md)
- [校园地点](../../../../docs/domains/place.md)
