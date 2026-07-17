# 食堂领域包

`packages/domains/dining` 拥有 Dining 领域模型、发布校验、开发 seed，以及食堂平面图的 canonical
layout、生成 manifest 和静态 SVG 生成器。领域架构见
`../../../docs/architecture/domains/dining/architecture.md`。

## 地图身份

- `floorplanId` 是稳定语义身份，供 catalog、release 和 Campus Web 构建关联同一张地图。
- `svgAnchorId` 把 physical window 绑定到地图区域。
- SHA-256 只命名生成后的静态 SVG，并用于浏览器完整性校验和 immutable cache；它不是业务身份，
  不写入 Dining 数据库或 app-api 响应。

## 编辑流程

1. 启动本地编辑器：

   ```bash
   pnpm --dir packages/domains/dining floorplans:edit
   ```

2. 在编辑器中修改布局并点击“保存”。保存使用读取时的 source revision，冲突时返回 409；它只原子
   更新 `src/floorplans/layouts/<floorId>.json`，不会改变学生端静态资产。
3. 所有楼层均无未保存修改后，点击“生成静态地图”，或运行：

   ```bash
   pnpm --dir packages/domains/dining floorplans:generate
   ```

4. 生成器确定性重建 `src/floorplans/generated-assets.json` 和当前 digest SVG，并清理未跟踪且不再
   属于当前 manifest 的中间 SVG。已提交的历史 digest SVG 不会被自动删除。
5. 提交前验证：

   ```bash
   pnpm --dir packages/domains/dining floorplans:check
   pnpm --dir packages/domains/dining typecheck
   pnpm --dir packages/domains/dining test
   ```

## Anchor 演进

添加或调整 physical window 时先保留旧 anchor 并添加新 anchor，再由 Ops rebase、绑定和发布 catalog。
只有仍需支持的 release 都不再引用旧 anchor 后才删除它。当前 manifest 可以包含旧 release 未使用的
新增 anchor；rollback 只拒绝目标 release 引用已不存在或重复的 anchor。

生成、领域发布和浏览器加载会在各自信任边界重复检查布局、digest、SVG 安全和 anchor 一致性。这些
检查分别保护 source、构建产物、release 和浏览器输入，不应合并成一次校验或由数据库字段替代。
