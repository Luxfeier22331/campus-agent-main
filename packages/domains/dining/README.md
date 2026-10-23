# Dining 领域

本包维护食堂、楼层、窗口和平面图的合同、校验、SVG 生成与公开投影，以及正式菜单、文本评价、
举报和编辑历史的领域合同与声明式 schema。浏览器 HTTP 编排、数据库读写和运营操作由所属应用实现。

用户行为、数据消费边界和投稿合同见 [Dining PRD](../../../docs/product/dining.md)。
精确合同见 [src/domain/](./src/domain/)，当前结构见 [src/schema.ts](./src/schema.ts)。
投稿、本人视图和治理 DTO 已定义于 [submissions.ts](./src/domain/submissions.ts)，对应数据库、App API 投稿和双目标评价、Ops 治理接口已实现；
菜单与评价合同继续由 `content.ts` 维护，投稿页面与生命周期清理由 Campus Web、Ops Web 和 App API 实现。

`src/floorplans/bootstrap-floorplans.v1.json` 只用于初始化空环境，当前包含已经校准的丰台校区平面图，
以及供本地维护流程使用的海淀第一至第四食堂待维护占位楼层。海淀占位图不是已校准的公开内容，
需要在 Ops Web 中补充实际地图信息后再作为正式内容使用。部署 bootstrap 使用正式发布实现写入首个 release 和当前 publication；初始化完成后，
数据库中的地图草稿和发布版本是运行事实源，Ops Web 不回写仓库文件。

```bash
pnpm --dir packages/domains/dining typecheck
pnpm test --filter=@campus-agent/dining
```
