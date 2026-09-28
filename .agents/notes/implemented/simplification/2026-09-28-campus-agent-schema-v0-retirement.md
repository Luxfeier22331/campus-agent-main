# Agent Note: campus-agent-schema v0 升级路径退役

Status: implemented

## 背景

`campus-agent-schema` Job 的 README 把三层时间线压成现在时：v0→v1 ledger 升级（一次性）、
个人记忆硬切（2026-09 一次性）、旧 runner 对象检查（旧 runner 已退役）。代码里
`compareHistory` 的 `named` 参数、`readStatus` 的 `information_schema.columns` 检测和
`LEGACY_OBJECTS` 数组都是为这些一次性路径服务的；v0 环境已确认不存在后，它们成为永远执行
但永不命中的死代码。

## 决策

删除一次性升级路径，README 按"当前有效事实"重写：

- `history.ts` 的 `compareHistory` 删除 `named` 参数和 v0 hash 匹配分支，只按迁移名比较；
- `migrate.ts` 删除 `LEGACY_OBJECTS`、`readLegacyObjects`、`assertLegacyObjectsAbsent` 和
  `readStatus` 的 `named` 检测；`status` 不再返回 `"legacy"`；
- `test/fixtures/v0-history.json` 更名为 `released-history.json`（它记录的是已发布迁移清单，
  不是 v0 特有）；
- `upgrade.integration.ts` 删除 v0 相关子测试（v0 complete、staging v0、v0 ledger conversion、
  legacy runner objects），保留空库安装、并发迁移、具名 ledger、auth 约束、失败回滚和非 owner
  拒绝；
- README 删除"显式序号"（旧约定，与现状矛盾）、0002 逐字段解释（migration 是历史记录）、
  个人记忆硬切的现在时描述（已完成事件）和 seed 归属说明（越界，归 `application-bootstrap.ts`）。

## 未采用方案

- **保留 v0 路径加注释标注退役条件**：v0 环境已确认不存在，保留死代码只会扩大测试面；
- **删除 `upgrade.integration.ts` 整个文件**：该文件还覆盖空库安装、并发迁移、auth 约束和
  失败回滚，这些是非 v0 的长期行为，保留有价值。

## 后果

`compareHistory` 的 `named` 参数和 `migrate.ts` 的 legacy 检查不再有运行时路径。若未来出现
v0 ledger 环境，`status` 会因 `name` 列缺失而报 `pending`（不会静默通过），`migrate` 会因
hash 不匹配报 `Applied migration SQL changed`（不会误升级）。

集成测试 7/7 通过（含并发、失败回滚、非 owner 拒绝），单测 9/9 通过。

操作、字段和失败处理分别由[维护手册](../../../../docs/runbooks/execution.md)和
[README](../../../../jobs/campus-agent-schema/README.md)维护。
