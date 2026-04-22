---
doc_type: reference
status: active
created: 2026-04-14
updated: 2026-04-21
---
# Institutional Regulations Offline Inventory

## 文档边界

本文只维护 regulation downstream consumption 的当前离线 inventory。

它回答的是：

- 哪些 captured items 当前属于 `institutional_rules`
- 哪些当前属于 `scoped_rules`
- 哪些仍停在 duplicate hold / auth-blocked / out-of-scope

它不回答：

- promotion/materialization acceptance 细节
- target-side chunk acceptance 命令
- query-serving reopen

相关文档：

- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery
  .md`

## Institution-Wide Current Target

当前仍属于 `regulations/institutional_rules` 的 target 只保留 institution-wide stable
regulation，例如：

- `中央民族大学采购工作管理办法`
- `中央民族大学关于学生使用人工智能的指导意见 / 2026版`

固定解释：

- attachment-backed owner body 允许进入当前 target
- wrapper notice 本身不充当 target owner

## Scoped Rules Holding Target

以下 captured items 当前属于 `regulations/scoped_rules`，不再回混到 `institutional_rules`：

- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `药学院2021年硕博连读博士研究生招生实施细则`
- `历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `中央民族大学丰台校区就医管理办法（暂行）`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

## Hold / Blocked Frontier

### Duplicate Hold

- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
  - primary：`191176`
  - 当前只保留 source truth，不再生成第二份 regulation target

### Excluded

- `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
  - 该样本已被显式排除，不再作为 auth-dependent `file_release` owner recovery target
  - historical source truth 继续保留，但 non-auth downstream line 与 auth
    owner-recovery line 都不再继续承接它

## Out Of Scope For Regulation Target

- `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
- `177880 / 关于印发实施《中央民族大学学生申诉管理办法》的通知`

固定解释：

- 这些 follow-up 当前不进入 regulation target
- 其中 handbook / wrapper follow-up 继续在各自 owner lane 处理

## Usage Rule

- 需要看“哪些 title 当前在哪个 target bucket”，读本文
- 需要看 identity / provenance / materialization acceptance，读
  `institutional-regulations-promotion-quality-acceptance.md`
- 需要看 current frontier 的 execution status，读 `.planning/WORKSTREAMS.md` 与对应
  workstream `STATE.md`
