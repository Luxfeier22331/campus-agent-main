---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-14
---

# Institutional Regulations Promotion Quality Acceptance

## 文档边界

本文记录 `campus_notices/internal_notice -> regulations/institutional_regulations` 这条 promotion/materialization 线当前已经冻结的质量真相。

它回答的是：

- promoted target document 的 identity 应该如何定义
- duplicate notice 应如何保留 provenance
- 当前 materialization 到哪里为止才算通过

当前离线 corpus 清单见：

- `docs/reference/institutional-regulations-offline-inventory.md`

它不回答：

- target collection 什么时候进入 chunk preparation
- target collection 什么时候进入 release / alias publish

## 当前 acceptance truth

### 0. 当前 execution truth 与批准迁移目标必须分开写

固定要求：

- 本文只记录当前 execution / materialization 已成立的 acceptance truth
- 已批准但尚未落代码的 contract 变更，不得伪装成当前 truth

截至 2026-04-14：

- 当前 target `document_id` 已由 `regulation_work_title + issuing_org + semantic scope` 派生
- 当前 projected/materialized `title` 已默认切到 `regulation_display_title`
- 当前 promotion / projection / materialization 保留：
  - `regulation_work_title`
  - `regulation_edition_label`
  - `regulation_display_title`
  - `source_title_literal`
- `regulation_title_normalized` 继续保留为 source-facing normalized title metadata
- 已批准的下一步 title/version contract 见：
  - `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `regulation_display_title` 当前固定保留完整 `regulation_edition_label` 语义：
  - `... / 2026版`
  - `... / 2026年修订`
  - 不是 `... / 2026`

### 1. Target identity 不得从 `notice_id` 派生

固定要求：

- target `document_id` 必须由 `regulation_work_title + issuing_org + semantic scope` 派生
- `notice_id` 只能存在于 provenance metadata，不得作为 target 主身份

### 2. Duplicate notice 只能保留一个 promoted canonical document

固定要求：

- 同一制度正文跨多个 notice 命中 duplicate/same-content 时，只保留一个 promoted target document
- duplicate notice 的 provenance 必须聚合进 target metadata，而不是静默丢失

当前聚合字段：

- `source_notice_ids`
- `source_notice_document_ids`
- `source_document_ids`
- `source_parent_document_ids`
- `source_attachment_document_ids`
- `source_attachment_ref_ids`
- `source_attachment_sha256s`
- `semantic_owner_document_ids`
- `duplicate_source_document_ids`

### 2.5 provenance 必须显式区分 notice 层和 owner 文档层

固定要求：

- `notice` 只作为来源层，不得冒充 `regulation` 的正文 owner
- promoted regulation metadata 必须显式保留：
  - `source_notice_document_id`
  - `semantic_owner_document_id`
- attachment-backed regulation 中，这两个字段不得相同
- notice-body regulation 中，`semantic_owner_document_id` 可以等于 `source_notice_document_id`

### 3. Target materialization 当前必须 stop 在 `offline_preparation`

通过条件：

- canonical markdown 已生成
- target document-units 已生成
- target registry scope 已被 scope refresh 替换
- `internal_notice` source scope 未被改写

当前仍不属于通过条件的内容：

- target chunk preparation
- embedding / Qdrant write
- release / alias publish

### 3.5 Repo-local acceptance 必须使用隔离 snapshot root

固定要求：

- source local snapshot 可以作为 read side truth
- local-only materialization 验收时，target registry/object-store 输出必须落到隔离目录
- 不得把长期 `local-smoke/object-store` 直接当作 target 输出根

### 4. Parent wrapper notice 只能提升独立正文

固定要求：

- parent-body candidate 必须去掉 wrapper 语义后再进入 target canonical markdown
- `关于发布/印发/修订...的通知` 这类 wrapper 行不得残留为 target 标题或 target 正文前导

### 5. Source scope refresh 与 target scope refresh 必须分离

固定要求：

- `internal_notice` 保留 source/triage truth
- `institutional_regulations` 单独做 target scope refresh
- 不能把 source row 直接“改名”成 target row

## 当前 local-only acceptance truth（2026-04-12）

当前已通过隔离 snapshot root 的 local-only materialization acceptance、并实际进入 `institutional_regulations` 输出的标题为：

- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `药学院2021年硕博连读博士研究生招生实施细则`
- `历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `中央民族大学采购工作管理办法`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `中央民族大学丰台校区就医管理办法（暂行）`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

当前 Cohort A 已不再存在 residual `manual_review_required` notice。

其中：

- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定` 已 promotion 并 materialize
- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定` 当前保留为 `hold_in_internal_notice` duplicate，指向 `191176`

## 当前 formal local current-scope truth（2026-04-14）

- 上述 Cohort A `10` 条仍按 vetted notice-id 白名单保留在 formal local current target 中，不再只是 isolated snapshot acceptance
- `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知` 已通过 bounded source-truth repair + targeted source projection rebuild + filtered materialization，正式并入当前 target
- `regulations/institutional_regulations` 的 local current target count 现已由 `10` 刷新为 `11`
- formal import 仍固定停在 target canonical/document-units/object-store + target registry scope refresh；不包含 chunk preparation、embedding、Qdrant write、release 或 alias publish
- 当前 formal current source scope 仍宽于 accepted batch；因此 target materialization 只能对白名单 notice 执行，不能对未过滤的 `internal_notice` current scope 直接全量推进

## 当前 Cohort B discovery truth（2026-04-14）

- 2026-04-14 对 local current scope 重新执行 promotion manifest 发现，真正有效的修复不是单纯补 section-heading title guard，而是把 parent notice 的 formal-regulation 判定收窄到 title-level signal。
- fresh current-scope manifest 结果为：
  - `candidate_count = 10`
  - `hold_count = 6`
  - `manual_review_count = 5`
- 这 `10` 条 `promote_candidate` 与已经验收并导入的 Cohort A 一致；当前没有新增的健康 direct parent-body promote candidate。

当前新增冻结要求：

- parent notice 不得因为正文里引用了 `办法 / 意见 / 方案` 等词就被判成 formal regulation
- 明显的章节标题，例如 `一、选课范围`、`第X条`、`（一）...`，不得被抽成 `regulation_title_normalized`
- parent notice 的 formal / handbook classification 只能使用 title-signal text：
  - `source_title`
  - source-truth inventory 中的 `notice_title`

本轮被修复并降回 `hold_in_internal_notice` 的典型 false positive 包括：

- `351118 / 关于2025-2026学年第一学期本科生网上选课的通知`
- `354192 / 关于2025-2026学年第二学期本科生网上选课的通知`
- `354862 / 关于组织开展2026年春季学期研究生毕业资格审核工作的通知`

当前 regulation lane 的下一步不再是放宽 parent-body promote，而是继续收口 owner body recovery。

截至 2026-04-14 的新增冻结真相：

- `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
  - 已通过 owner recovery pilot 证明可从现有本地 bundle + attachment source bytes 恢复
  - 修复点是 attachment provenance 传播：
    - projection plan 必须保留 `attachment_content_sha256`
    - promotion 对旧快照可从 `source-truth/attachment-refs.jsonl` 回填 `source_attachment_sha256`
  - fresh isolated pilot 结果中，attachment child 已恢复为 `promote_candidate`
- `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
  - 仍然不是 promotion 逻辑问题
  - 当前 blocker 继续是 `file_release_backed_regulation_body_missing`
  - 截至 2026-04-14，repo 内没有这条 notice 对应的 `file_release` export bundle / manifest / source bytes
  - 截至 2026-04-14，repo 已补齐 bounded `file_release` downstream readiness contract：
    - 可读 bundle / manifest
    - 可判定 `ready / missing_capture / missing_source_bytes / ambiguous_match`
  - 但当前 repo 还没有真正恢复 `file_release` owner body，更没有把 recovered owner 自动接进 regulation promotion/materialization
  - 因此下一步必须先在认证窗口内完成 bounded `file_release` capture，再单独补 `file_release -> owner body recovery` consumer；不能用 wrapper notice 正文代替 regulation owner

新增 metadata 语义冻结：

- `regulation_display_title`
  - 当前固定使用 `<work title> / <edition label>` 的 repo-local display convention
  - `edition_label` 必须保留完整版次语义，不得为了显示压成裸年份
  - `暂行`、`试行`、`民大校发〔2025〕104号`、`2026届` 这类信号不得误拆成 `edition_label`

- `source_notice_release_time`
  - 表达 notice wrapper 的发布/观测时间
  - 可以稳定作为 issued-like provenance metadata 保留
- `effective_date`
  - 只在 owner text 明确写出“自某日施行 / 生效”等信号时提取
  - 缺失时允许为 `null`
  - 不得用 `source_notice_release_time` 静默顶替

截至 2026-04-14 的 attachment-backed formalization 新增真相：

- `355282` 先前已在隔离 object-store + in-memory registry 环境中验证可 materialize；随后又完成 local current-scope formalization，当前已正式进入：
  - `regulations/institutional_regulations`
- target 保留的关键 metadata 为：
  - `document_id = institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
  - `title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
  - canonical markdown heading = `中央民族大学关于学生使用人工智能的指导意见（2026版）`
  - `semantic_owner_kind=attachment_document`
  - `source_notice_release_time=2026-03-27 15:15`
  - `effective_date=null`
- 因此这条样本当前已满足并完成 regulation import lane 的受控导入要求

截至 2026-04-14 的 replay/rematerialization 新增真相：

- 已对白名单 Cohort A 执行 fresh formal local current-scope replay/rematerialization
- replay 前后：
  - `before_target_count = 10`
  - `after_target_count = 10`
- 这次 replay 没有引入新的 promoted rows，也没有把 manual-review / hold notice 泄漏进 target scope
- 这次 replay 的实际效果是把本地 target rows 收敛到当前 execution truth：
  - `regulation_work_title`
  - `regulation_edition_label`
  - `regulation_display_title`
  - `source_title_literal`
  这些 metadata 现已在 local current target rows 上可见
- 对当前 Cohort A 而言，`document_id` 没有因为 replay 发生集合级变化；这是因为这批 accepted works 本身没有新的 work-title/version-title 分叉样本
- 真正验证 work-title identity 切换的是 `355282`；它当前已不再只是隔离样本，而是 formal current target 中的 attachment-backed regulation

## 当前 repo 级验证面

当前这条线的 repo verification 固定至少覆盖：

- `tests.ingestion.test_internal_notice_regulation_promotion`
- `tests.ingestion.test_build_internal_notice_regulation_promotion_manifest_worker`
- `tests.ingestion.test_internal_notice_regulation_materialization`
- `tests.ingestion.test_materialize_internal_notice_regulation_worker`
- `tests.ingestion.test_authenticated_notice_source_projections`
- `tests.ingestion.test_rebuild_authenticated_notice_source_projections_worker`

这些测试当前锁住的事实包括：

- duplicate provenance 聚合
- target scope refresh 替换旧 target rows
- target canonical markdown 去 wrapper
- split title/version metadata 从 promotion 保留到 projection / materialization
- target `document_id` 使用 `regulation_work_title`
- target `title` 使用 `regulation_display_title`
- worker CLI 的 request/filter 传递
- section heading 不得被误抽成 regulation title
- parent notice 不得仅凭 body citation / body heading 晋升为 formal regulation
