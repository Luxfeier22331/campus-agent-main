# 交通班次领域包

本包定义班车结构化数据的共享类型、校验和展示标签。它不读取通知、图片或对象存储，也不承担数据
写入和页面渲染。

当前数据由 Ops Web 直接维护：`routes` 保存线路，`schedule_periods` 保存按日期和星期生效的完整
时间段，`schedule_items` 保存固定或间隔班次及其乘车点。App API 读取这三类数据生成按日期的公开接口，
Campus Web 只消费该接口。班次乘车点按“班次明细 → 时间段覆盖 → 线路默认”的顺序继承。

线路同时保存可空的下车点 `dropOffPoint` 和乘车指引 `boardingGuide`。公开响应的 `routeCatalog`
提供完整线路目录及最近运行日期，`routes` 仅保留请求日期的运行／停运班次结果。

```bash
pnpm --dir packages/domains/transport typecheck
pnpm --dir packages/domains/transport test
```

领域边界见 [`docs/domains/transport.md`](../../../docs/domains/transport.md)。
