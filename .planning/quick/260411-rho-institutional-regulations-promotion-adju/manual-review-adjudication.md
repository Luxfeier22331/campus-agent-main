# Cohort A Manual-Review Adjudication

## Decision

- Cohort A rerun 之后，`institutional_regulations` 仍只有 `187233` 一个 `promote_candidate`。
- 其余 `10` 条继续保持 `manual_review_required`，但 manual 的理由已被重新校正：
  - 不再使用“旧文档”作为 exclusion signal
  - 不再使用 `暂行/试行` 作为自动 manual signal
  - 改为按 `document_nature` 分流

## Bucket 1: `annual_cycle_rule`

这些通知的共同点不是“年份旧”，而是它们本身就是年度/项目制规则：

- `186957 / 中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `186977 / 药学院2021年硕博连读博士研究生招生实施细则`
- `187004 / 历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `196411 / 中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `351907 / 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `353963 / 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `354006 / 中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

固定结论：

- 这些文本不进入 `regulations/institutional_regulations`
- 保留为 `manual_review_required`
- 默认只支持 `explicit_year_only` 检索策略

## Bucket 2: `time_bound_operational_rule`

### 暑假实验室规则

- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`

固定结论：

- 这是季节性运营规则，不是长期 institution-wide regulation
- `191177 / 191176` 仍保留 duplicate-source observation

### `191705` 的特殊说明

- `191705 / 重要通知--中央民族大学丰台校区就医管理办法（暂行）`

这条继续不进 `institutional_regulations`，但理由必须改成正文语义，而不是标题词：

- 正文出现 `临时医疗点`
- 正文出现 `校医院正式运营前`
- 正文出现 `正式运营后取消`

因此：

- 它是被显式 transition/sunset semantics 排除
- 不是被 `暂行` 这个词单独排除

## Guardrail Update

这次 quick task 固化了一个 repo-local guardrail：

- 如果一份制度正文只是“老”，不自动降权或排除
- 如果标题含 `暂行/试行`，但正文没有年度/项目制或显式临时/过渡语义，不自动进入 manual
- 只有正文出现明确 temporary/sunset 或 annual-cycle/program-specific semantics，才排除出 `institutional_regulations`
