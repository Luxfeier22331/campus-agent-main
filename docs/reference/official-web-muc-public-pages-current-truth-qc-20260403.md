---
doc_type: reference
status: historical
created: 2026-04-03
updated: 2026-04-12
---

# Official Web MUC Public Pages Current Truth QC (2026-04-03)

## 文档边界

本文记录 `official_web/muc_public_pages` 在 2026-04-03 当前 worktree 的 repo-tracked quality truth，用于说明：

- 当前 registry truth 的真实规模
- 当前可用于本地 retrieval 验证的正确 physical collection
- cross-host 同文去重与 low-signal fail-close 的现状
- repo-tracked qrels/live retrieval benchmark 的当前结果
- `rag-specialist` answer-path 在本地真实链路下的当前结果

它不表示：

- `official_web/muc_public_pages` 已进入默认 query-serving surface
- 当前 runtime profile 已经开放 retrieval
- 2026-04-05 本地 unpublished candidate release 已经 publish alias 或开放默认 query-serving
- 采集范围要继续扩大

对应真相源：

- runtime profile：`configs/ingestion/official_web/muc_public_pages/runtime-profile.json`
- retrieval qrels：`packages/evals/fixtures/official_web_muc_public_pages_retrieval_qrels.json`
- retrieval fixture manifest：`configs/ingestion/official_web/muc_public_pages/split-manifest.v1.json`
- page-level QC inventory：`packages/evals/fixtures/official_web_muc_public_pages_current_truth_inventory.json`
- `official_web` 长期 serving 策略：`docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- future fresh-news handoff：`docs/reference/official-web-fresh-news-surface-handoff.md`
- `rag-specialist` answer-path：`packages/rag-specialist/src/campus_rag_specialist/service.py`

## 当前 truth

- 当前 `official_web/muc_public_pages` registry current truth 为 `21` 条逻辑文档，不是 replay 报告里的 `28`
- 当前最新一轮本地验证使用的 unpublished physical collection 是 `muc_public_pages__r20260404_184508`
- 当前本地 release-candidate baseline 已切到 `release_id=r20260404_184508`
- 当前 published alias 仍未切换；上一轮 physical collection 仍是 `muc_public_pages__r20260402_152206`
- 当前 runtime profile 仍保持：
  - `serving_stage=offline_preparation`
  - `retrieval_enabled=false`
  - `query_enabled_by_default=false`

## 2026-04-04 本地 Source-Truth Repair 与 Chunk Cleanup 验证

这轮 2026-04-04 closeout 覆盖 Phase 10.2 与 Phase 10.3 的连续本地验证，只重跑 `project -> validate -> chunk audit`，不改 registry current truth，也不改 Qdrant release / alias。

- Phase 10.2 intermediate replay：
  - `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v7`
  - 关闭 `article_detail` 过度聚合：`学校概况 / 学校简介 = 3 units`、`本科培养 / 研究生培养 / 博士后 = 2 units`
- Phase 10.3 first replay：
  - `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v8`
  - `project` / `validate` 已通过，但 chunk audit 仍报 `header_context_drift=14`、`article_section_over_aggregation=1`
  - 这轮失败最终确认是 audit false positive，而不是 repaired replay 又重新退化
- Phase 10.3 final replay：
  - `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v9`
  - replay 结果：`29 pages_seen / 28 emitted_documents / 1 manual_review`
  - projection validator：`28 documents / 0 errors / 0 warnings`
  - chunk audit：`118 units / 138 chunks / 0 issues`
  - `118 units` 高于 v7 的原因是 support-only line 现在保留为显式 structured-unit role；`138 chunks` 低于 v7 的原因是这些 support-only unit 不再进入 chunk / retrieval path

当前对 final replay v9 的人工抽样结论：

- `本科培养`
  - 无 standalone `source_only` chunk
  - 两个 chunk 都保持 `标题：本科培养 | 章节：人才培养`
- `博士后`
  - 无 standalone `source_only` chunk
  - 两个 chunk 都保持 `标题：博士后 | 章节：人才培养`
- `校长强世功接受“统战新语”专访 解读民族团结进步促进法`
  - 不再出现 newsroom disclaimer-only chunk
  - 当前 chunk header 为合法 title-only labeled header，不再被误报为 drift
- `学校概况`
  - promotable chunk 不再退回 `学校概况 / 学校简介` 这类 slash identity
  - 当前 header 保持 `标题：学校概况 | 章节：学校概况 > 学校简介`
- `“民图一小时”信息素养讲座预告`
  - `notice_fact` 事实组继续保留为 grouped fact unit
  - 前几个 chunk header 不再退回 slash identity，且 audit 不再把该事实组误报成 over-aggregation

这说明当前本地 `release_gate_required` 子集的 fixed-scope clean/chunking blocker 已经关闭；后续如需继续推进，应是是否基于 final replay v9 重新做 import/release candidate，而不是继续停留在 `source_only` / `terminal_boilerplate` / header drift 或 notice-fact false positive 上。

## 2026-04-05 本地 Import / Release Candidate / Gate Rerun

这轮 2026-04-05 执行把 replay v9 真正滚入本地 registry current truth candidate，并补齐 release-gate 证据。

- 先关闭两个真实兼容性 blocker：
  - `PostgresDocumentRegistry` 读取旧 registry row 时会因为历史 `acl_level / acl_groups / campus_scope` payload 失败；当前已在 persisted-row read path 做 canonicalization，不放松 raw/file payload 的严格校验
  - `packages/evals/src/campus_evals/retrieval_live_benchmark.py` 仍在向 `RetrievalRequest` 传旧 `campus_scope / acl_groups`；当前已切到 canonical `AuthorizedRetrievalFilter`
- final replay v9 import：
  - command baseline：`/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v9`
  - import report：`success_count=14 / skipped_count=14 / failed_count=0`
  - artifact：`/tmp/official-web-qc-20260401-batch-d-clean-subset-import-v9/import-reports/official-web-import-2026-04-04T184411.150539_plus_0000.json`
- unpublished release candidate：
  - `release_id=r20260404_184508`
  - `physical_collection_name=muc_public_pages__r20260404_184508`
  - `document_count=21`
  - `point_count=109`
  - `validation_status=passed`
  - 这轮使用 `--no-publish-alias`，所以 published alias 未变
- retrieval qrels gate：
  - command artifact：`/tmp/official-web-muc-public-pages-live-run-v9.json`
  - `total_cases=9`
  - `hit@1=1.000`
  - `hit@3=1.000`
  - `recall@5=1.000`
  - `precision@5=1.000`
  - `mrr@5=1.000`
  - `forbidden_hit_rate=0.000`
- live answer gate：
  - output dir：`/tmp/official-web-live-gate-v9`
  - `total_cases=13`
  - `passed=13 / failed=0`
  - `gate_report.overall_verdict=pass`
  - deterministic `run_pass_rates=[1.0]`
- Qdrant 轻量抽样：
  - `学术名流 -> 费孝通` chunk 仍保留完整人物事实段，`final_token_count=342`
  - `学校简介` chunk 仍保留学校概况主体事实段，`final_token_count=348`
  - `中央民族大学与北京丰台人才集团共建就业实习实践基地` chunk 仍是新闻正文事实段，不是 newsroom disclaimer 或尾部噪音

这说明 replay v9 不仅在本地 projection/chunk audit 层闭环，也已经在 registry import、unpublished release、retrieval qrels 和 deterministic answer gate 四层闭环。当前 remaining decision 不再是“数据是否可形成 candidate”，而是“是否要 publish alias / query-enable”，并且这仍应在保持 `offline_preparation` 与 fixed-scope 边界不变的前提下单独判断。

## 去重与导入结果

- 下列 import / release figures 是 2026-04-03 baseline，保留在这里仅用于和 2026-04-05 candidate rerun 对照，不代表当前最新 candidate。
- projection replay：`29 pages_seen / 28 emitted_documents / 1 manual_review`
- projection replay validator：`28 documents / 0 errors / 0 warnings`
- chunk audit：`56 units / 132 chunks / 0 issues`
- 当前这轮增量 import report：`success_count=0 / skipped_count=28 / failed_count=0`
- `--require-promotable` 现在只导入 `promotable` 文档；`audit_only` 文档会被跳过并写回 import report
- 当前这轮 unpublished release：`release_id=r20260403_132316 / document_count=21 / point_count=108 / validation_status=passed`
- `news` / `xxgk` 的 cross-host 同文现在已经在 import truth 收口为单一逻辑文档，重复来源保留在 `source_observations`
- 当前 scope 里有 `3` 条低价值招聘 / 采购 / 公示 `article_detail` 页面已显式降为 `audit_only`，不进入 current truth：
  - `中央民族大学公开招聘及公示信息`
  - `中央民族大学2020年公开招聘补充公告`
  - `中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示`
- 已确认的 merged document 示例：
  - 就业实习基地：`official_web:muc_public:article_detail:ac8ea5921fa808dea152c171d6b0c6c0ba1cc62f`
  - 促进法解读：`official_web:muc_public:article_detail:871878763a91199730493efe0cbb0358b884fe58`
  - 以上两条当前都具备 `source_observations = 2`

## Retrieval 现状

当前 repo 已固定两条 official_web retrieval shaping 规则：

- low-signal query fail-close
  - `中央民族大学` 返回空结果
  - `食堂营业时间` 返回空结果
- final evidence source 对 `official_web/muc_public_pages` 执行 document-level diversity
  - 同一逻辑文档的多个 chunk 不再挤占 final top-k
  - final `EvidenceBundle.sources` 对该 scope 只保留每个 `doc_id` 的一个代表 source

2026-04-03 当天追加关闭的 retrieval 质量问题：

- 对 `stable_reference` title-target query，named-document support 现在会在同文档内补回 lead chunk，不再只保留中后段高分 chunk
- 代表 chunk 选择现在优先保住 lead / introduction，再看中后段内容加分
- 当前真实 `学校简介` query 的 final evidence 已从 `chunk-0004` 收口为 `chunk-0001`

## Repo-Tracked Qrels

当前官方网页面 qrels 固定为 `9` 个 case：

- `topic-law-interpretation`
- `cross-host-duplicate-employment-base`
- `stable-reference-school-profile`
- `stable-reference-current-leadership`
- `stable-reference-alumni-association-profile`
- `stable-reference-foundation-profile`
- `stable-reference-library-lecture-notice`
- `no-hit-campus-name-generic`
- `no-hit-unanchored-life-service`

固定规则：

- expected source 现在锁到真实 current `doc_id + version_id`
- `split-manifest.v1.json` 只承担 retrieval fixture validation；其中 `page_start/page_end` 是 synthetic sequential placeholders，不代表官网页面存在 PDF-like 分页语义

## Page-Level QC Inventory

当前 `21` 条 promotable current truth 已额外冻结为 repo-tracked page inventory：

- `release_gate_required = 11`
  - `学校简介`
  - `学校概况`
  - `现任领导`
  - `基金会简介`
  - `校友会简介`
  - `本科培养`
  - `博士后`
  - `研究生培养`
  - `学术名流`
  - `“民图一小时”信息素养讲座预告`
  - `校长强世功接受“统战新语”专访 解读民族团结进步促进法`
- `follow_up_candidate = 0`
- `inventory_only = 10`
  - `访问学者`
  - `干部人事`
  - `8` 条 news 页面
- inventory-only triage：
  - `retain_inventory_only = 2`
  - `current_scope_follow_up_candidate = 0`
  - `future_fresh_news_surface = 8`

对应 reference：

- `docs/reference/official-web-muc-public-pages-page-qc-inventory-20260403.md`

## Live Retrieval Benchmark

2026-04-03 使用真实本地链路对最新 unpublished physical collection 跑通：

```bash
uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/official_web_muc_public_pages_retrieval_qrels.json \
  --output /tmp/official-web-muc-public-pages-live-run-20260403-v6.json \
  --force-enable-retrieval \
  --qdrant-collection-name muc_public_pages__r20260403_132316 \
  --format json
```

结果：

- `total_cases=9`
- `hit@1=1.000`
- `hit@3=1.000`
- `recall@5=1.000`
- `precision@5=1.000`
- `mrr@5=1.000`
- `forbidden_hit_rate=0.000`

当前 retrieval qrels 已无已知 forbidden hit 或 secondary evidence leakage。

artifact：

- `/tmp/official-web-muc-public-pages-live-run-20260403-v6.json`

## Answer Path 现状

2026-04-03 对同一 unpublished physical collection 做本地 `rag-specialist` answer-path probe，使用 monkeypatch override：

- 保持 repo-tracked runtime profile truth 不变：`retrieval_enabled=false`
- 仅在本地 probe 中把 `qdrant_alias_name` 临时指向 `muc_public_pages__r20260403_132316`
- 仅在本地 probe 中临时打开 retrieval

验证 query：

- `中央民族大学学校简介`
- `中央民族大学学校概况`
- `中央民族大学现任领导`
- `中央民族大学基金会简介`
- `中央民族大学校友会简介`
- `中央民族大学本科培养`
- `中央民族大学博士后`
- `中央民族大学研究生培养`
- `中央民族大学学术名流`
- `民图一小时 信息素养讲座`
- `民族团结进步促进法 解读`
- `食堂营业时间`

当前结果：

- 前 `11` 个 query 现在都返回 `status=completed`
- 以上 `11` 个 query 当前都返回 `confidence=medium`
- `食堂营业时间` 继续返回 `status=no_answer / confidence=low`
- `official_web` 的 completed answer 前缀已改为“根据官网页面内容”
- `official_web` 的 no-answer 文案已改为官网页面范围提示，不再误用“学生手册问题”
- `中央民族大学学校简介` 当前 final evidence 已稳定命中 `chunk-0001`
- `中央民族大学学校概况` 当前 title-target retrieval 会保留同文档互补 chunk，覆盖“三个校区 + 12个学科门类”两类事实
- `中央民族大学博士后` 当前 same-doc support query 会主动补到“博士后科研流动站 + 合格率”事实 chunk，不再停留在只含“双一流”背景句的引导段
- `中央民族大学学术名流` 当前 same-doc support query 会稳定补回 `3` 个不同人物 chunk，answer-path 只保留代表学者与学科方向，不再直出 biography 时间线
- `民图一小时 信息素养讲座` 当前回答会优先返回讲座主题 / 时间 / 地点，不再把二维码预约尾行当成答案
- 当前 release gate 已把 `学校简介 / 学校概况 / 现任领导 / 校友会简介 / 基金会简介 / 本科培养 / 博士后 / 研究生培养 / 学术名流 / 通知 / 解读新闻` 分别拆成独立 answer-compression 路径，目标是压缩成可消费事实句，而不是沿用标题复述或整段正文直出

这说明当前 retrieval / answer path 的历史 blocker 已进一步收口，不再是 terminal branch、same-doc support、长 biography 压缩或 notice-tail answer 误判。2026-04-04 之后，本地 clean/chunking blocker 也已经关闭；当前尚未推进的只是是否把 repaired replay 再滚到新的 import/release candidate。

## Live Answer Gate

2026-04-03 当前 worktree 进一步把 answer-path 验证固化为 repo-tracked deterministic live gate：

```bash
uv run --all-packages python -m campus_evals.official_web_live_benchmark run \
  --reruns 1 \
  --qdrant-collection-name muc_public_pages__r20260403_132316 \
  --output-dir /tmp/official-web-live-gate-20260404-r132316-v6
```

结果：

- `total_cases=12`
- `completed=11 / no_answer=1`
- deterministic `run_pass_counts=[12]`
- deterministic `mean_pass_rate=1.0`
- `gate_report.overall_verdict=pass`
- `gate_report.deterministic_gate.verdict=pass`
- 当前 policy fixture 为 `packages/evals/fixtures/official_web_live_gate_policy.json`
- 这条 live gate 只做 deterministic specialist/retrieval/answer/fail-close 验证，不消费 supplemental judge/ragas metrics
- `gate-report.json` 现在显式写出 `deterministic_gate` hard gate 结果

artifact：

- `/tmp/official-web-live-gate-20260404-r132316-v6`

## 当前剩余风险

- answer-path 已闭环，但 `official_web` 当前回答仍严格受当前 imported dataset 的页面范围与单页正文质量约束
- `访问学者 / 干部人事` 已明确留在 `retain_inventory_only`；它们继续保留在 current truth，但当前 scope 下不再尝试进入 release gate
- 当前 `inventory_only` 已不再保留 stable-reference follow-up candidate；如果后续继续扩大 gate，应先重新证明页面值得进入终端问答面
- `8` 条 news 页面已明确转入 `future_fresh_news_surface` 方向；它们不应被误读为当前 stable-reference gate 的延迟候选
- 对这 `8` 条页面的后续处理边界，现以 `docs/reference/official-web-fresh-news-surface-handoff.md` 为准，而不是继续在当前 gate 文档里反复重判
- 低价值招聘 / 采购 / 公示详情页已经从 release truth 排除，但这不等于 `article_detail` 族整体都自动可 promote
- 当前本地 source-truth replay 已验证 `article_detail` 不再默认塌成单巨型 unit，但这轮还没有滚到新的 registry/Qdrant release；如果后续要做 release candidate，仍需补一次 import/release rerun 证据
- 后续风险主要落在 inventory-only 页面是否值得继续升 gate，以及更广泛的新闻/长文摘要治理，而不再是 retrieval terminal branch、lead-chunk recover、same-doc support 或 current fixed-scope clean/chunking 问题

## 当前结论

- `official_web/muc_public_pages` 现在已经具备 repo-tracked current truth、manifest、qrels、live retrieval benchmark 和本地 answer-path probe 的闭环
- cross-host 同文重复问题已经关闭，low-signal fail-close 符合当前策略
- `stable_reference_extended` gate 现已进一步收口：`本科培养 / 博士后 / 研究生培养 / 学术名流` 现已进入 deterministic live gate，`访问学者` 明确留在 `inventory_only`
- 当前 `inventory_only` 页面已完成 repo-tracked 三分流收口：`访问学者 / 干部人事` 留在 `retain_inventory_only`，不再保留 current-scope follow-up candidate，`8` 条 news 页面转入 future fresh-news 方向
- 低价值 public notice 页面现在已明确留在 staged audit truth，不再混入 `muc_public_pages` current truth
- 2026-04-04 本地 repaired replay 已证明 `release_gate_required` 的 source-truth projection / structured-unit / chunk audit 形态明显优于旧版本，当前 fixed-scope clean/chunking blocker 已关闭
- `rag-specialist` 对当前 scope 的 terminal branch 语义已经修正，不再误把官网问题当成 handbook/curriculum 语义处理
- 当前 scope 仍应继续保持 `offline_preparation`，不要把这组本地验证结果误读为“已经可以默认开放官网检索面”
