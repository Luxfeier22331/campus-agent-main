---
doc_type: domain
owner_boundary: domains/transport
status: active
---

# 交通班次领域

## 边界

交通班次是由运营人员维护的结构化产品数据。班车线路、有效时间段和班次明细由 Ops Web 直接写入
`transport` schema；App API 按日期读取并生成公开响应；Campus Web 只展示 App API 的结果。

本领域不把校园通知、图片附件或 OCR 结果作为运行时班次事实来源。通知和 OCR 由通知数据面独立采集，
运营人员可以参考 Ops Web 中的识别结果录入结构化时间段；两条链路不自动回放或覆盖班次。

## 数据模型

- `transport.routes`：线路目录，包含起点、终点、服务类型、默认乘车点、下车点、乘车指引和展示顺序。
- `transport.schedule_periods`：线路的一段完整生效周期，包含起止日期、ISO 星期、运行/停运状态、可选
  上下车点覆盖和乘客说明。
- `transport.schedule_items`：时间段内的班次明细。固定班次保存一个时间，间隔班次保存首班、末班和
  间隔分钟数；乘车人群、容量和可选的班次级乘车点属于班次明细。
- `transport.schedule_period_notices`：时间段与通知的多对多关联，可选保存一段面向运营人员的关联说明。
  关联由 Ops Web 独立维护，不改变时间段的生效优先级或 `updatedAt`；通知删除或时间段删除时关联随之删除。

一个时间段表达它覆盖范围内的完整班次表。App API 对同一线路选取适用于请求日期的时间段；当多个时间段
同时适用时，使用较新的生效范围。停运时间段返回线路和停运状态，但不返回班次明细。

`GET /api/transport/schedule?date=YYYY-MM-DD` 同时返回完整 `routeCatalog` 和当天生效的 `routes`。
目录按运营配置顺序排列，不因当天无班次而隐藏；每条目录记录包含独立的 `dropOffPoint`、
`boardingGuide` 以及查询日当天或之后的 `nextServiceDate`（没有后续运行安排时为 null）。最近运行日期
复用同一时间段选择规则，包含停运覆盖，不通过备注推断节假日安排。

下车点默认值和乘车指引是线路级资料，由 Ops Web 普通表单维护，可清空；时间段可通过
`dropOffPointOverride` 覆盖下车点，null 或未传时继承线路值。不从说明或通知正文自动拆取。
前台将相同乘车点合并展示，仍保留班次之间的地点差异，预约与申请步骤可展开查看。

## 当前基线

基线数据与初始化代码位于 `apps/ops-web/ops/db/transport-baseline.ts` 和
`apps/ops-web/ops/db/bootstrap-transport.ts`。本地 `pnpm dev:init` 和生产 `ops-web-bootstrap` Job
都通过 Ops Web bootstrap 写入空数据库；migration 只负责表结构、索引和授权，不内置业务数据。

当前基线包含两校区通勤、五棵松和篱笆房地铁接驳线路，以及丰台至海淀线路的持续乘车点。后续调整直接在
Ops Web 修改结构化线路、完整时间段或班次明细。

基线也包含 2026 年 4 月 28 日至 5 月 5 日专项安排：六个方向、25 条固定班次。该日期范围独立于
秋季常规基线，不外推到其他假期。bootstrap 仍只初始化空数据库，不覆盖已维护的排班。

Ops 月历选择日期后显示实际生效的完整班次，可直接进入对应时间段编辑。范围套用选定一个时间段后，
将其完整班次应用于目标范围的每一天；保存前可修改星期并逐日比较前后班次、地点、容量和备注。
长期影响按 31 天翻页查看；有限范围可查看至范围结束次日。结束安排也先预览后确认。
Campus 日期选择器按当前线路和人群显示整月班次，复用范围结果供单日查询。

Campus 单日和月历查询均传 `include=notices`，并使用包含该变体的缓存键。线路安排区展示时间段
乘客说明与已发布关联通知；运营关联说明仅在后台展示。关联不参与时间段优先级选择。
日期、服务类型、线路和乘车人群写入 URL；从班车进入站内通知再返回时恢复筛选，登录跳转保留该返回目标。

历史样本位于 `packages/domains/transport/test/fixtures/history.ts`。完整表包括 355867 的
4月27日及4月28日—5月5日、357803 的暑期表、356341 的持续增班表；354343、355512、351862、353903
的局部调整使用显式受控起始表验证，不冒充历史全表。357813 与358327共同界定暑期停运和恢复日期。
这些数据只用于测试和显式本地验收，不加入生产 bootstrap。

本地验收可在已初始化的 worktree 执行：

```bash
pnpm --dir apps/ops-web exec tsx test/fixtures/seed-transport-history.ts <已持久化的通知产物目录>
```

脚本仅写本 worktree 的本地数据库和 derived bucket，复用已有五一时间段、保留秋季基线；
准备9条真实通知正文、7张图片及21个历史时间段（含复用），不调用 OCR 或访问集群。

发布顺序：先由统一 schema Job 执行 `0010_transport_notice_display`（字段和授权），再发布 App API，
最后发布 Ops/Campus Web。旧 Campus 未传 `include` 时继续消费原响应。

## Owner

- `packages/domains/transport`：共享类型、输入校验和展示标签。
- `apps/ops-web`：`transport.*` 的写入所有者，提供线路、时间段和班次明细 CRUD。
- `apps/ops-web`：同时负责时间段关联通知的维护，以及从通知详情反向查看关联的历史时间段。
- `apps/app-api`：读取班次数据，按需批量读取已发布关联通知元数据，按日期生成公开投影。
- `apps/campus-web`：调用公开接口并展示线路、乘车点、运行状态和班次。
- `jobs/campus-agent-schema`：安装表结构、索引和数据库授权。

没有旧表兼容层、自动班次消费任务或证据审核表。OCR 结果属于通知运维能力，不改变班次数据 owner。
若未来引入自动来源写入，必须先明确新的数据 owner 和公开数据合同，再单独设计输入到结构化班次的写入边界。

## 验证

```bash
pnpm --dir packages/domains/transport typecheck
pnpm test --filter=@campus-agent/transport
pnpm --dir apps/app-api typecheck
pnpm --dir apps/ops-web typecheck
pnpm --dir apps/campus-web typecheck
```

## 相关文档

- [共享类型与展示标签（packages/domains/transport）](../../packages/domains/transport/README.md)
- [通知领域（时间段关联通知）](../architecture/domains/notices.md)
- [Ops Web 通知合同（关联维护）](../contracts/ops-web/notices.md)
