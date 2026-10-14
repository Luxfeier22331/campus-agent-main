# Agent Note: 检索结果多样性与合成输入去重

Status: implemented

## 背景

对 #562 类多维问题的受控分析确认：多次串行 campus_search 不是执行层重试，而是模型发现
信息缺口后的主动补查。根因是单次返回的
5 条结果被多篇通知的"正文开头"占满，未覆盖申请条件、合作院校、费用资助等事实维度。
选段循环（`campus_docs.go`）纯按 rerank 分数排序，无任何多样性或章节逻辑。

多次检索返回的 evidence 全部透传给合成器，其中包含大量重复 title 和 section 的通知片段，
增加了合成上下文冗余。

## 决策

### 选段多样性（execution-control）

在 `campus_docs.go` 选段循环中增加两遍选择：

1. 第一遍按 rerank 分数顺序，施加多样性约束：
   - 同一来源（SourceKind + NoticeID 或 DocumentID）最多占 2 条；
   - 同一来源 + SectionTitle 组合最多 1 条。
   被限流的候选记入 `caps.deferred`，diagnostic 标记 `same_notice_cap` 或
   `same_section_cap`。
2. 第二遍从 deferred 回补：当第一遍未填满 resultLimit 时，按原顺序回补被限流的
   候选（仍受 EvidenceCharBudget 约束）。回补时清除 diversity exclusion reason；
   budget 不足时更新为 `evidence_char_budget`。

分组 key 使用 `SourceKind + "\0" + 来源 ID`，章节 key 再追加 SectionTitle；Notice 与 Document
即使 ID 和章节名相同也不共享限额。保留既有 `same_notice_cap` 诊断值，Ops 将其显示为“同一来源片段数量限制”。

`snapshot.SourceGroupedExcludedCount` 记录第一遍被限流的候选数。

该机制不减少返回总数，不破坏 citation_index 顺序分配（选定后分配），
不修改 rerank 合同（结果数严格等于候选数）。

### 工具描述引导（configs/runtime）

`tool-function-schemas.v4.json` 的 `campus_search` 描述更新：

- `search_query`：引导模型包含事实维度词（申请条件、费用、资助、合作院校等）
  和时间范围，多个维度用空格分隔。
- `search_goal`：首次检索时列出问题涉及的所有事实维度，让单次检索尽量覆盖。

描述变更会改变 contract fingerprint（运行时从 JSON 内容计算），两侧部署需同步。

### 合成输入去重（agent-runtime）

本节的章节级去重已由[回答证据与时间上下文](../bug-fix/2026-10-13-answer-evidence-and-time-context.md)
取代：同一章节的不同片段可能承载互补事实，合成输入改为仅按证据 ID 去重。检索选段多样性与工具描述决策继续有效。

`synthesisPayload` 在 `normalizeEvidence` 之后增加 `deduplicateSynthesisMaterials`：
按 `来源 ID（noticeId 或 documentId）+ title + sectionTitle` 去重，同一来源同一章节只保留
第一条（最高排名的）。来源 ID 参与 key 是因为 staging 语料验证确认同一单位逐年重发的
系列通知共享标题和章节名是常态形态（126 组同标题通知中 111 组有跨通知共同章节），
不含来源 ID 会误删不同通知的合法引用。非 campus_search 来源的 evidence 不受影响。

### Solver prompt（agent-runtime）

`solve` prompt 新增一条：首次检索时在 search_query 中包含所有事实维度，
在 search_goal 中列出这些维度，让单次检索尽量覆盖，减少补查轮次。

## 未采用方案

- 全局提高规章制度权重或降低通知权重：当前不存在全局权重代码，意图驱动权重
  需要新建分类机制，改动范围中-大。本轮先用多样性约束解决最紧迫的"正文开头
  占满结果"问题。
- resultLimit 5→8/10 并配合提高 EvidenceCharBudget：经离线 A/B 实验否决（见"后果"）。
  v9 分块后单条证据更聚焦，5 条结果平均仅约 1,000 字符，4,000 预算平均使用率约 25%，
  条数和预算都未饱和；提高到 8 条只多带 rerank 刚过阈值的边缘通知，维度覆盖不变，
  反而增加合成输入冗余和耗时。
- 并行补查：串行是显式设计（citation_index 顺序分配 + excludedResultRefs 跨调用
  累积确定性），并行化需重构证据合并顺序，属行为合同变更。本轮不动。
- Solver facets 结构化输出：需改 agent-runtime schema + execution-control 校验 +
  合同测试，双端 lockstep。改动范围中-大，本轮不做。

## 后果

### 验证

execution-control、agent-runtime 和 contracts 的单元、类型及合同检查覆盖多样性 cap、回补、
既有 evidence 排除、重排后限额和互补章节边界。

### 受控样本结果（否决 resultLimit 提高）

受控多维问题对照显示，多样性 cap 在不增加结果条数和证据预算的情况下提高了不同通知和章节的
覆盖；提高 resultLimit 只增加边缘通知，未扩大事实维度覆盖。因此保留 cap，不增加默认结果数。

### 覆盖缺口

- 多样性 cap 的阈值（同通知 2 条、同 section 1 条）是固定的，未做查询意图感知。
  对于确实需要同一通知多个章节的查询（如"某个通知的全部内容"），cap 可能限制
  信息完整性，但回补机制确保 resultLimit 仍被填满。
- P2/P5 的 prompt 和工具描述需要按发布流程在真实流量中继续观察，单次受控样本不代表普遍流量。
- 原 P3 按来源 ID + title + sectionTitle 去重会误删同章节互补片段，已由上述修复取代。
- 独立部署的 Qdrant 冷启动性能未纳入本决策的行为合同。
- 工具描述变更需要协调发布以避免 `tool_contract_mismatch`。
