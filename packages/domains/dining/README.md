# 食堂领域包

`packages/domains/dining` 拥有 Dining 领域模型、数据库 schema、发布校验、开发数据，以及食堂
平面图的规范布局和生成资产清单。它不依赖 React、Vite 或画布编辑器。

## 地图身份

- `floorplanId` 是稳定语义身份，连接 catalog、release 和 Campus Web 中的同一张地图；
- `svgAnchorId` 把物理窗口绑定到地图区域；
- SHA-256 只命名生成后的静态 SVG，并用于完整性校验和不可变缓存，不写入 Dining 数据库或
  app-api 响应。

本地地图编辑和静态 SVG 生成由 `packages/dining-editor` 提供，操作说明见
`../../dining-editor/README.md`。领域包只维护可被运行时消费的布局、manifest 和校验逻辑。

## Anchor 演进

添加或调整物理窗口时先保留旧 anchor 并添加新 anchor，再由 Ops Web 重建草稿、绑定和发布目录。
只有仍需支持的 release 都不再引用旧 anchor 后才删除它。rollback 会拒绝引用已不存在或重复
anchor 的目标 release。

## 验证

```bash
pnpm --dir packages/domains/dining typecheck
pnpm --dir packages/domains/dining test
```

领域架构见 `../../../docs/architecture/domains/dining.md`。
