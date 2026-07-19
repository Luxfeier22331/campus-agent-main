---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0050
status: accepted
---
# ADR-0050 Campus Web 产品入口

## 背景

问答、文档、地图、食堂、反馈和账号属于同一个学生产品。使用多个浏览器外壳会重复导航、认证
返回路径和账号体验，也会让联邦登录的公开 issuer 与实际产品入口分离。

## 决策

- `apps/campus-web` 是学生侧唯一浏览器应用，组合产品首页、问答、文档、地图、食堂、反馈和账号
  页面；
- 账号路由和认证表单由 Campus Web 组合，认证、会话和联邦登录实现继续属于 app-api；
- Campus Web 通过同源受控路由调用 app-api，浏览器不直接选择内部服务地址；
- OAuth/OIDC 的公开 issuer 与 Campus Web 产品来源一致，具体来源和环境值由部署配置维护；
- 新的学生能力进入现有导航和账号外壳，不建立第二个启动页或账号应用。

## 结果

- 学生在一个产品中完成账号、问答和校园信息任务；
- 认证返回目标、公开 issuer 和浏览器导航使用同一产品来源；
- app-api 保持认证与产品数据职责，不承担浏览器界面组合。

## 未采用方案

- 用独立启动页连接多个学生应用；
- 为账号和认证返回路径维护第二个浏览器外壳；
- 让浏览器根据环境自行拼接 app-api 或联邦登录地址。

## 相关文档

- `../architecture/current.md`
- `../architecture/system/product-runtime.md`
- `../product/web.md`
- `../architecture/system/identity-authz.md`
- `../contracts/app-api/federation.md`
