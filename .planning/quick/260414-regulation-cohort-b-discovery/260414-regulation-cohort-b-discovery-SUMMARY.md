# Quick Task 260414-regulation-cohort-b-discovery Summary

**Description:** 收紧 `internal_notice -> institutional_regulations` current-scope promotion guardrail，并确认 Cohort B 是否存在可继续导入的 regulation  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- 已确认本轮真正有效的修复是：parent notice 的 formal-regulation 判定改为只看 title-signal text，而不是看正文中是否出现制度关键词。
- fresh current-scope manifest 已从：
  - `candidate_count = 13`
  - `hold_count = 3`
  - `manual_review_count = 5`
- 收敛为：
  - `candidate_count = 10`
  - `hold_count = 6`
  - `manual_review_count = 5`

## Cohort B Verdict

- 当前 `10` 条 `promote_candidate` 与既有 Cohort A 已导入集合一致。
- 当前没有新的健康 direct parent-body regulation candidate。
- 因此 Cohort B 不能继续走 “扩大白名单 -> materialize” 路径。

## False Positives Removed

以下三条已经从误判的 `promote_candidate` 降回 `hold_in_internal_notice`：

- `351118 / 关于2025-2026学年第一学期本科生网上选课的通知`
- `354192 / 关于2025-2026学年第二学期本科生网上选课的通知`
- `354862 / 关于组织开展2026年春季学期研究生毕业资格审核工作的通知`

这些 notice 的共同问题是：

- body 中引用了制度名词
- body 中有看起来像制度结构的章节标题
- 但它们本身仍然是 operational wrapper notice，不是 regulation owner text

## Next Frontier

regulation lane 现在真正值得继续推进的只剩 owner-body recovery：

- `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
- `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`

当前不属于 `institutional_regulations` 直接导入目标的 manual-review 项还包括：

- `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `355119 / 附件 1 / 中央民族大学拔尖创新人才培养 “证书项目”报名表`

## Artifacts

- [run-output/promotion-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260414-regulation-cohort-b-discovery/run-output/promotion-manifest.json)
- [run-output-after-parent-title-signal/promotion-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260414-regulation-cohort-b-discovery/run-output-after-parent-title-signal/promotion-manifest.json)
- [run-output-after-parent-title-signal/document-reports.jsonl](/home/reptilian/code/campus-agent/.planning/quick/260414-regulation-cohort-b-discovery/run-output-after-parent-title-signal/document-reports.jsonl)
- [institutional-regulations-promotion-quality-acceptance.md](/home/reptilian/code/campus-agent/docs/reference/institutional-regulations-promotion-quality-acceptance.md)
- [internal-notice-manual-review-collection-strategy.md](/home/reptilian/code/campus-agent/docs/reference/internal-notice-manual-review-collection-strategy.md)
- [internal-notice-policy-regulation-promotion-runbook.md](/home/reptilian/code/campus-agent/docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md)
