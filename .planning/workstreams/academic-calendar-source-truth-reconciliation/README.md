---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Workstream: Academic Calendar Source Truth Reconciliation

这条 workstream 负责修复 `calendar/academic_calendar` 的 source-truth
合成问题：基础校历图不能单独定义最终查询事实，后续正式通知中的教学安排、补课/公休覆盖、
停课与组合活动安排必须进入同一个 projection/read-model truth。

触发问题是 2026 年 4 月底至 5 月初安排：

- 学生口径的“春假”不是官方命名事件。
- 官方通知表述为 `运动会、春季社会实践周、劳动节假期` 期间课程调整。
- `2026-04-27` 至 `2026-05-05` 是课程停课安排。
- `2026-05-01` 至 `2026-05-05` 是校历和通知中的 `劳动节假期`。
- `2026-04-25` 是上班上课并执行 `5月5日` 教学计划。
- 当前 curated 校历把 `2026-05-09` 记成 `执行周一课表`，但两条正式通知均写明
  `5月9日（周六）正常公休`。

## Scope

本 workstream 覆盖：

- `calendar/academic_calendar` source-truth 合成规则
- 基础校历与 authenticated notice calendar-arrangement facts 的优先级
- `course_suspension`、`normal_rest_day`、`workday_makeup` 等日状态语义
- `春假` 作为 colloquial alias 的解释与回答口径
- projection conflict detection、validation、doctor 与 release gate
- `academic_calendar_lookup` 的 deterministic resolver、planner/eval fixture 与文档口径

本 workstream 不覆盖：

- 重新打开独立 `calendar-agent`
- 查询时回扫 raw notice HTML、图片 OCR 或 generic RAG
- 个人课表、考试安排、预约、申请等事务能力
- 把 `春假` 写成官方 source truth 事件名
- notice 原文检索；`找春假通知原文` 仍应走 notice search/card

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`
- planning review: `./PLANNING-REVIEW.md`

## Initial Evidence

- curated calendar has `2026-05-01` to `2026-05-05` as `劳动节假期`:
  `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/central-minzu-2025-2026.v1.json`
- authenticated notice `355589` states `5月1日—5月5日放假`、`4月25日上班上课`、
  `5月9日正常公休`
- authenticated notice `355682` states `4月27日至5月5日` 因运动会、春季社会实践周及劳动节假期
  课程停课，`4月25日` 正常上课，`5月9日` 正常公休

## Completion Target

完成后必须能稳定回答：

- `今年春假是什么时候`
- `2026-04-28 上课吗`
- `2026-05-01 放假吗`
- `2026-05-09 上课吗`
- `4月25日为什么要上课`
- `春季社会实践周是什么时候`

并且必须证明：

- 官方名称、学生口语 alias、假期、停课、补课/公休之间不会互相误写
- source-backed answer 可以同时引用基础校历和后续通知
- 冲突不再静默进入 current projection
