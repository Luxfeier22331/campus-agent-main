---
doc_type: domain
owner_boundary: domains/transport
status: active
---

# 交通班次领域

## 边界

交通班次是由运营人员维护的结构化产品数据。班车线路、有效时间段和班次明细由 Ops Web 直接写入
`transport` schema；App API 按日期读取并生成公开响应；Campus Web 只展示 App API 的结果。

本领域不消费校园通知，不读取图片或附件，不执行 OCR，也不把通知正文作为运行时班次来源。通知仍由通知
数据面独立采集和发布，两条链路不互相回放或覆盖。

## 数据模型

- `transport.routes`：线路目录，包含起点、终点、服务类型、默认乘车点和展示顺序。
- `transport.schedule_periods`：线路的一段完整生效周期，包含起止日期、ISO 星期、运行/停运状态、可选
  乘车点覆盖和说明。
- `transport.schedule_items`：时间段内的班次明细。固定班次保存一个时间，间隔班次保存首班、末班和
  间隔分钟数；乘车人群、容量和可选的班次级乘车点属于班次明细。

一个时间段表达它覆盖范围内的完整班次表。App API 对同一线路选取适用于请求日期的时间段；当多个时间段
同时适用时，使用较新的生效范围。停运时间段返回线路和停运状态，但不返回班次明细。

## 当前基线

基线数据与初始化代码位于 `apps/ops-web/ops/db/transport-baseline.ts` 和
`apps/ops-web/ops/db/bootstrap-transport.ts`。本地 `pnpm dev:init` 和生产 `ops-web-bootstrap` Job
都通过 Ops Web bootstrap 写入空数据库；migration 只负责表结构、索引和授权，不内置业务数据。

当前基线包含两校区通勤、五棵松和篱笆房地铁接驳线路，以及丰台至海淀线路的持续乘车点。后续调整直接在
Ops Web 修改结构化线路、完整时间段或班次明细。

## Owner

- `packages/domains/transport`：共享类型、输入校验和展示标签。
- `apps/ops-web`：`transport.*` 的写入所有者，提供线路、时间段和班次明细 CRUD。
- `apps/app-api`：读取 `routes`、`schedule_periods`、`schedule_items`，按日期生成公开投影。
- `apps/campus-web`：调用公开接口并展示线路、乘车点、运行状态和班次。
- `jobs/campus-agent-schema`：安装表结构、索引和数据库授权。

没有旧表兼容层、通知消费任务或证据审核表。若未来重新引入自动来源，必须先明确新的数据 owner 和公开
数据合同，再单独设计输入到结构化班次的写入边界。

## 相关入口

```bash
pnpm --dir packages/domains/transport typecheck
pnpm --dir packages/domains/transport test
pnpm --dir apps/app-api typecheck
pnpm --dir apps/ops-web typecheck
pnpm --dir apps/campus-web typecheck
```
