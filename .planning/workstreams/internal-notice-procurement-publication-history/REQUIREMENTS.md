---
doc_type: requirements
status: backlog
created: 2026-04-24
updated: 2026-04-24
---

# Requirements: Internal-Notice Procurement Notice Classification

## Goal

为 `campus_notices/internal_notice` 中的采购 / 比选 / 招标 / 中选结果类 publication 建立独立 backlog，
长期把这类 source notice 收口为现有 notice / publication 存储中的稳定类别 `procurement_notice`，
而不是误投到 regulation、service runtime、generic notice consumption 或普通 campus news。

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

- restricted internal notice 中 `procurement_notice` 的分类边界
- `procurement_notice` 在现有 notice / publication 存储中的最小 metadata contract
- attachment-backed procurement notice 的 authority split
- `procurement_notice` 的 archive-only / non-default consumption posture
- current-state `audit/holding` posture，避免在 target surface 缺位时误消费
- 恢复为 active 时把分类真相写回 storage / projection contract，而不是另起重型采购流程模型

## Non-goals

- 当前 `regulations/institutional_rules` / `regulations/scoped_rules` 下游消费
- 当前 `notice-agent` runtime opening
- authenticated live portal scheduling / auth bootstrap / control-plane
- `official_web` procurement notice 的并轨消费
- `stage` 字段、project lifecycle object 或完整 procurement process schema
- panel、chatbot、retrieval serving、release publish 的即时实现

## Success Criteria

1. repo planning truth 明确这类 notice 当前不属于 regulation target，也不属于当前 notice runtime opening。
2. `355222` 这类公告与 `355325` 这类结果公示可以在不新增 `stage` 字段的前提下，共同落入
   `procurement_notice` 分类。
3. `procurement_notice` 的最小 metadata contract 被冻结，至少覆盖：
   - `publication_category`
   - `source_notice_id`
   - `title`
   - `body`
   - `published_at`
   - `organization_name`
   - `attachment_refs`
4. attachment-backed procurement notice 的 authority / completeness 语义被显式区分，但不要求为
   procurement notice 单独引入 lifecycle object。
5. 当前 target surface 未存在时，系统保持 `audit/holding` 或 future archive-only posture，而不是猜测性地开放 query-serving。

## Canonical Entry

- `.planning/workstreams/internal-notice-procurement-publication-history/README.md`
