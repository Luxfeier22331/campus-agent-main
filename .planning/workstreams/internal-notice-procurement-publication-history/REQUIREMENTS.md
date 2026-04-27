---
doc_type: requirements
status: backlog
created: 2026-04-24
updated: 2026-04-28
---

# Requirements: Internal-Notice Procurement Publication History

## Goal

为 `campus_notices/internal_notice` 中的采购 / 比选 / 招标 / 中选结果类
publication 建立轻量历史查询验收：在已存在的 `procurement_notice` family
与 `procurement_notice_history` target surface 上，保证 Web 侧至少能通过
notice discover/get 拿到稳定的 title + url card。

这条 backlog 不再表示“还没采购分类”。当前重点是产品化最低消费合同：
低优先级或暂不深处理的 notice 可以只做分类、分流、检索命中和 title/url
返回，不要求正文总结、附件解析、VLM 处理或独立 tool。

## Captured Examples

1. `355222 / 中央民族大学海淀校区学生宿舍供电智能管理系统维保服务项目比选公告`
   - `2026-03-25 10:30`
   - 含 1 个 `docx` 附件：`公开比选公告附件-学生宿舍供电智能管理系统维保服务项目(1).docx`
   - 应归类为 `procurement_notice`，不是制度正文
2. `355325 / 中央民族大学海淀校区学生宿舍供电智能管理系统维保服务项目中选结果公示`
   - `2026-03-31 16:42`
   - 正文含 `中选供应商：北京合众慧能科技股份有限公司`、`中选金额：82220.00元`
   - 也应归类为 `procurement_notice`，不要求额外 `stage` 字段

## In Scope

- `procurement_notice_history` 的 notice card contract
- 所有 queryable notice 的最小 Web card 字段：
  - `notice_id`
  - `title`
  - `source_url`
  - optional `canonical_url`
  - `published_at`
  - `source_family`
  - `target_surface`
- 采购类 notice 的分类、分流、检索和 title/url 返回验收
- 低优先级 notice 的最低消费口径：正确分类 / 分流 / 可检索 / title+url
- attachment-backed procurement notice 的 authority split 只用于 completeness
  与未来深处理判断，不阻塞 title/url card
- restricted visibility and auth boundary for internal notice cards

## Non-goals

- 当前 `regulations/institutional_rules` / `regulations/scoped_rules` 下游消费
- 新增 dedicated procurement runtime tool
- 新增 procurement lifecycle object、stage machine 或供应商流程模型
- authenticated live portal scheduling / auth bootstrap / control-plane
- `official_web` procurement notice 的并轨消费
- 强制所有采购附件进入 OCR / VLM / 正文摘要
- 强制低优先级 notice 进入深度消费或 agent answer synthesis

## Success Criteria

1. repo planning truth 明确 procurement backlog 已从“补分类”更新为
   “采购历史 notice card / title-url contract 验收”。
2. `355222` 这类公告与 `355325` 这类结果公示可以通过
   `target_surfaces=["procurement_notice_history"]` 检索命中。
3. 所有 queryable notice card 至少返回：
   - `notice_id`
   - `title`
   - `source_url`
   - `published_at`
   - `source_family`
   - `target_surface`
4. `campus_notice_get` 对 resolved notice 必须返回 `title` 和 `source_url`；
   正文不可用时，允许 reference-only 返回原文链接。
5. 采购类 notice 不误投到 `regulations/*`、`campus_services/*` 或 generic
   service/status tool。
6. 低优先级 notice 不要求深处理，但必须保持可解释的 family/route/status，
   且在被 queryable admission 时能返回 title/url。

## Canonical Entry

- `.planning/workstreams/internal-notice-procurement-publication-history/README.md`
