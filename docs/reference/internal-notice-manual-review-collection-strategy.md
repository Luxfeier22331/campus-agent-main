---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-14
---

# Internal Notice Manual-Review Collection Strategy

## 文档边界

本文记录 `campus_notices/internal_notice -> regulations/institutional_regulations` 这条线在 2026-04-12 local-only acceptance rerun 之后，原先 residual `manual_review_required` boundary 的关闭方式。

它回答的是：

- 为什么 `191176 / 191177` 不再停在 `manual_review_required`
- 为什么 `annual_cycle_rule` / `time_bound_operational_rule` 信号本身不再是当前这条线的硬排除条件
- 当前 duplicate hold 与 regulation target 的分界是什么

它不回答：

- 未来是否要为 residual notice 另建 holding lane
- query-serving reopen 之后的完整 query-planning 细节
- auth-dependent live portal 后续采集

## 当前冻结结论

### 1. 已通过 `institutional_regulations` local-only acceptance 的 10 条标题

当前已通过 local-only materialization acceptance、并实际物化进隔离 snapshot root 的标题为：

- `186957 / 中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `186977 / 药学院2021年硕博连读博士研究生招生实施细则`
- `187004 / 历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `187233 / 中央民族大学采购工作管理办法`
- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `191705 / 中央民族大学丰台校区就医管理办法（暂行）`
- `196411 / 中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `351907 / 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `353963 / 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `354006 / 中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

固定判断：

- 当前这条导入线不再把 `annual_cycle_rule` 或 `time_bound_operational_rule` 当作自动排除条件
- 这些 distinction 继续保留在 target metadata 中，例如 `document_nature`
- 当前是否允许进入 `institutional_regulations`，主要看：
  - wrapper 语义是否已去除
  - canonical regulation body 是否独立成立
  - required metadata / provenance 是否齐备

### 2. 当前 residual manual-review 已清零

当前 Cohort A 已没有 `manual_review_required` notice 留在这条 regulation promotion 线上。

这条 family 的当前处理结果是：

- `191176`：通过 document-number stripping + wrapper-leading 清洗后，恢复出可独立成立的 regulation body，已进入 `institutional_regulations`
- `191177`：由于 promotion body 与 `191176` 语义一致，当前作为 duplicate hold 保留在 `internal_notice`，不再生成第二份 regulation target

固定判断：

- 当前关键修复不是重新分类 `time_bound_operational_rule`，而是：
  - 文号行剥离后继续执行 wrapper-leading 清洗
  - 对 parent notice 采用语义正文去重，而不是继续依赖原始 `content_hash`
- `time_bound_operational_rule` 信号继续只是 target metadata，不构成 admission 排除条件

## 当前可执行结论

- 当前 regulation 导入线已经可以把这 `10` 条 accepted canonical text 视为 `institutional_regulations` 真相
- `191177` 继续保留在 `internal_notice` 层作为 duplicate hold source truth，不单独升格为第二份 regulation
- 如果未来要为 duplicate hold notice 增加单独 review lane，那是后续新增决策，不能回写成当前已经冻结的导入真相

## 当前 current-scope residual frontier（2026-04-14）

- fresh current-scope manifest 已确认：除了上面这 `10` 条 accepted title 之外，没有新的健康 direct parent-body regulation candidate。
- 以下 notice 当前明确留在 `internal_notice`，不能再误升格进 `institutional_regulations`：
  - `351118 / 关于2025-2026学年第一学期本科生网上选课的通知`
  - `354192 / 关于2025-2026学年第二学期本科生网上选课的通知`
  - `354862 / 关于组织开展2026年春季学期研究生毕业资格审核工作的通知`

固定判断：

- 上述三条的正文虽然引用制度或包含章节结构，但它们本身仍是 wrapper / operational notice
- parent notice 的 body citation 与 body heading 不能充当 formal-regulation admission evidence

当前仍值得继续推进的 regulation manual-review frontier 已收缩为 file-release owner 缺失的一条：

- `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
  - 当前不是 promotion heuristic 问题
  - 当前 repo 已具备一条 bounded `file_release` readiness consumer：
    - 可读 export bundle / manifest
    - 可判定 `ready / missing_capture / missing_source_bytes / ambiguous_match`
  - 当前仍缺的是：
    - repo-local `file_release` capture artifact
    - 以及真正恢复 owner body 的 downstream consumer
  - 在这两层补齐前，必须继续停在 `manual_review_required`

新增冻结真相：

- `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
  - 已通过 owner recovery pilot 脱离 residual manual-review frontier
  - 当前正确语义是：
    - parent notice 继续留在 `internal_notice`
    - attachment child 才是可 promote 的 regulation owner body
  - 真正修复点是 attachment provenance 补齐，不是放宽 promotion 分类

其余 current-scope manual-review 文档目前不属于 `institutional_regulations` 直接导入目标：

- `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `355119 / 附件 1 / 中央民族大学拔尖创新人才培养 “证书项目”报名表`
