# 食堂平面图编辑器

`packages/dining-editor` 是本地设计工具，负责编辑 Dining canonical layout，并确定性生成学生端使用的
静态 SVG 与资产清单。领域模型与运行时数据合同仍由 `@campus-agent/dining` 拥有。

## 编辑流程

1. 运行 `pnpm --dir packages/dining-editor floorplans:edit`，在浏览器中修改布局并保存。
2. 保存只原子更新 `packages/domains/dining/src/floorplans/layouts/<floorId>.json`；source revision
   冲突会返回 409。
3. 运行 `pnpm --dir packages/dining-editor floorplans:generate`，重建
   `packages/domains/dining/src/floorplans/generated-assets.json` 和
   `apps/campus-web/public/assets/dining/` 下的 digest SVG。
4. 提交前运行：

   ```bash
   pnpm --dir packages/dining-editor floorplans:check
   pnpm --dir packages/dining-editor typecheck
   pnpm --dir packages/dining-editor test
   ```

生成器只清理未跟踪且已不属于当前 manifest 的中间 SVG，不会删除已提交的历史 digest SVG。
