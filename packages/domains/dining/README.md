# Dining 地图领域

本包只维护食堂、楼层、窗口和平面图的合同、校验、SVG 生成、公开投影与三张运行表。

`src/floorplans/bootstrap-floorplans.v1.json` 只用于初始化空环境，并且只包含已经校准的丰台校区
平面图。初始化完成后，数据库中的地图草稿和发布版本是运行事实源，Ops Web 不回写仓库文件。

```bash
pnpm --dir packages/domains/dining typecheck
pnpm --dir packages/domains/dining test
```
