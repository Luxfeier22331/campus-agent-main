# Dining 领域

本包维护食堂、楼层、窗口和平面图的合同、校验、SVG 生成与公开投影，以及正式菜单、文本评价、
举报和编辑历史的领域合同与声明式 schema。浏览器 HTTP 编排、数据库读写和运营操作由所属应用实现。

用户行为、数据消费边界和已接受、待实现的用户投稿需求见 [Dining PRD](../../../docs/product/dining.md)。
精确合同见 [src/domain/](./src/domain/)，当前结构见 [src/schema.ts](./src/schema.ts)。
投稿、本人视图和治理 DTO 已定义于 [submissions.ts](./src/domain/submissions.ts)，对应数据库、App API 投稿和双目标评价、Ops 治理接口已实现；
旧菜单与评价合同继续由 `content.ts` 维护，投稿页面和生命周期清理仍由应用分阶段接入。

`src/floorplans/bootstrap-floorplans.v1.json` 只用于初始化空环境，并且只包含已经校准的丰台校区
平面图。部署 bootstrap 使用正式发布实现写入首个 release 和当前 publication；初始化完成后，
数据库中的地图草稿和发布版本是运行事实源，Ops Web 不回写仓库文件。

```bash
pnpm --dir packages/domains/dining typecheck
pnpm test --filter=@campus-agent/dining
```
