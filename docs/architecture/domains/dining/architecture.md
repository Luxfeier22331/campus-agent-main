---
doc_type: architecture
owner_boundary: domains/dining
status: active
---

# 食堂领域

## 边界

食堂能力由一份发布快照同时服务学生地图、菜品和评价读取。数据生产、发布、HTTP、地图资产和
运维界面各有独立所有者，不能把 fixture、SVG 存在或 source observation 误认为学生端已可见。

## 所有者

| 所有者 | 职责 |
| --- | --- |
| `packages/domains/dining` | 领域类型、投影、release lifecycle、floorplan manifest 和 dev seed |
| `jobs/dining-sync` | 飞书 catalog/review 同步、内容审核、附件物化和发布 |
| `apps/app-api` | dining schema、学生读取接口和已注册的受控运维接口 |
| `campus-web` | 学生地图、档口、菜品和评价展示 |
| 环境仓 | Job/CronJob、Secret、数据库、对象存储和不可变 image |

当前 `operator-console-web` 不提供食堂页面，也不代理 `/api/ops/dining/*`。运维接口存在不代表
已经具备浏览器运维界面。

## 数据生产

```text
飞书目录
-> 目录来源观测
-> 已接受目录
-> 草稿与发布候选校验
-> 已发布快照与当前指针

飞书评价
-> 审核与附件物化
-> 评价来源观测
-> 评价投影
```

`sync-all` 先更新并发布 catalog，再根据当前 catalog 解析 review。app-api 不在启动或请求时
导入 fixture，也不访问飞书。开发环境可以显式导入 dev seed；生产 source truth 来自批准的
catalog sync。

## 核心对象

- Hall：校区内食堂；
- Floor：学生可选择的一张地图；
- Window：地图上的物理档口锚点；
- Stall Profile：可跨有效期描述经营档口；
- Assignment：某时间段 Stall Profile 与 Window 的关系；
- Menu Item：菜品身份；
- Menu Offering：Assignment 下菜品和可选价格展示；
- Review Projection：审核通过并绑定当前 hall/stall/window 的评价；
- Release Snapshot：学生端唯一读取的 published projection。

Window、Stall Profile 和 Assignment 必须分离，避免档口换商家时改写历史。价格只保存展示文本，
不是库存、支付或可计算价格合同。

## 平面图

floorplan SVG 和 manifest 由 `packages/domains/dining/src/floorplans` 与 campus-web 静态 asset
共同版本化：

- manifest 固定 hall/floor/floorplan ID、SHA-256、asset URL 和 anchor inventory；
- Window `svgAnchorId` 必须对应受控 `data-dining-anchor-id`；
- HTTP 只返回 manifest metadata，不返回 SVG markup、bucket 或 object key；
- campus-web 校验 HTTP metadata 与本地 manifest；不一致时失败关闭；
- `placeholder:` floorplan 明确表示地图待补充，可以用受控 geometry 显示可点击占位档口；
- dining anchor 只服务食堂选择，不是 campus navigation route graph。

地图资产变化通过应用版本发布，不由 ops HTTP 上传或修改。

## 发布生命周期

```text
draft
-> release candidate
-> validate
-> approve
-> publish now 或 schedule
-> immutable release snapshot
-> latest pointer
```

- candidate 冻结 snapshot hash、floorplan ref 和 expected predecessor；
- validation blocker 未清零不能 approve/publish；
- publish 原子写 release、snapshot、latest pointer 和 audit；
- predecessor 不一致时停止，不能覆盖并发发布；
- rollback 把 latest pointer 切回既有 release 和 snapshot，并写审计，不改写历史；
- scheduled job 只执行已批准 candidate。

学生 API 只读 latest published snapshot。没有 published release 时 halls 返回空列表，floor
请求按合同返回 typed 404；不能回退到 draft、dev seed、内存 fixture 或 source observation。

## 学生投影

学生端只展示：

- 校区、食堂和可选地图；
- 地图锚点、档口标签和状态；
- 当前 assignment、菜品名、tag 和可选价格文本；
- 已审核且绑定当前 catalog 的评价和本地静态图片；
- source 更新时间摘要。

不展示 draft、candidate、audit、source observation、release ID、采集统计、file token、临时
下载 URL、菜品库存或售卖状态。评价自由文本菜品名不自动合并为 canonical menu item。

## 运维投影

app-api 运维接口可以读取和修改 draft 对象、创建/验证/批准/发布 candidate、查看 release 与
audit，但当前没有网页消费这些接口。接口不返回 raw provider row、credential、原始附件或
对象存储 key。

source observation 的 accepted/blocked/stale 状态属于 ingestion evidence，不直接成为学生数据。
catalog 关系缺失时记录 blocked，不猜测映射；review 必须按校区、食堂、档口解析到 published
identity。

## 内容审核与附件

review 文本和图片在 Job 中审核。图片先写 moderation prefix，通过后复制到 public review prefix，
失败时不进入公开 projection。published URL 必须是学生可读的稳定静态 URL，不得保存飞书 token
或临时下载地址。

## 非目标

- 不做点餐、支付、库存或实时排队；
- 不从在线请求访问飞书、审核 provider 或对象存储管理接口；
- 不让 Agent/tool 直接查询 draft/ops schema；
- 不把食堂 floorplan 当作校园导航地图；
- 不以 fixture 或 SVG 文件存在证明上线。

## 相关文档

- `../../../data/dining.md`
- `../../../contracts/app-api/dining.md`
- `../../../contracts/app-api/dining-ops.md`
- `../../../runbooks/dining.md`
