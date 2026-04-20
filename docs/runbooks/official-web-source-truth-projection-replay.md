---
doc_type: runbook
status: active
created: 2026-03-31
updated: 2026-04-12
---

# Official Web Source-Truth Projection Replay

## 文档边界

这份 runbook 负责 `official_web` 在 source-truth QC 通过之后的 projection replay。

它回答的是：

- 如何把本地 collector output replay 成 canonical document artifacts
- 如何验证当前 replay batch 中出现的 page family 都有显式 declaration
- 如何确认 shell 页仍停留在 `manual_review`
- 如何区分 staged audit truth 与 promotable truth

它不负责：

- 扩 host 范围
- 进入 chunk/index/retrieval gate
- 直接把任何 `official_web/*` collection 打开成默认 query-serving surface

如果当前目标是继续验证 `official_web/muc_public_pages` 的 retrieval / answer 质量，应在 replay + validator + chunk audit + import + release 之后，转到：

- retrieval：`campus_evals.retrieval_live_benchmark`
- answer path：`campus_evals.official_web_live_benchmark`
- current truth / future news handoff：`docs/reference/official-web-fresh-news-surface-handoff.md`

## 适用边界

`official_web` 在这一步仍处于：

`source-truth -> declared projections -> canonical document artifacts`

因此这一步只验证 document-level replay truth，不验证 retrieval 或 answer quality。

## 批次类型

projection replay 固定服务两类输入批次：

- stable regression gate
  固定 5-host 回归批次；用于证明 extractor、QC 和 replay 仍然稳定
- low-budget expansion batch
  面向 stable gate 外、但已 allowlisted 的 host；用于证明新增 host 已经通过 source-truth + replay 基线

它不负责判定：

- host 是否应该加入 `scheduler-policy.json`
- host 是否应该进入 `hot lane`
- host 是否应该开启 query-serving

因此要显式区分：

- host 已 allowlisted
- host 已通过一次 expansion batch
- host 已成为 scheduler / hot lane 候选

## 稳定回归批次

`muc_public` 的 `site.json` / `hosts.json` / `seeds.json` 已经覆盖多于 5 个公开 host。
这里保留的 5-host 只是稳定 replay / regression gate，不代表唯一允许进入
source-truth 的 host 范围：

- `www.muc.edu.cn`
- `news.muc.edu.cn`
- `xxgk.muc.edu.cn`
- `xiaoyou.muc.edu.cn`
- `lib.muc.edu.cn`

如需对已启用的新增 host 做扩面验证，只要该 batch 的 source-truth QC 通过，且 batch 中出现的
`pageFamily` 全部落在当前 declaration 范围内，就可以沿用同一套 replay/validator。

`2026-04-02` 的 Batch A 提供了一次扩面验证示例：

- `law.muc.edu.cn`
- `history.muc.edu.cn`

repo-tracked declaration 入口：

- [projection-declarations.json](/home/reptilian/code/campus-agent/configs/sources/official_web/muc_public/projection-declarations.json)

当前已接受的第一波 declaration：

- `article_detail` -> emitted document
- `listing_page` -> emitted document
- `directory_page` -> emitted document
- `generic_content_page` -> emitted document
- `dynamic_shell_page` / `structural_shell_page` -> `manual_review`

当前已接受的 routed downstream scope：

- `official_web/stable_reference`
  - 只接受 stable-reference-like 说明型页面
  - 已验证可从 mixed replay output 中按 scope 单独 import / release
  - 仍保持 `offline_preparation`，不得表述成已开放 query-serving

bridge scope 仍只作为 projection declaration / mixed replay truth：

- `official_web/muc_public_pages`

补充约束：

- replay 输出的 `listing_page` / 部分 `generic_content_page` 可用于本地 canonical / chunk audit
- homepage / portal-style `directory_page` 也只允许留在 staged audit truth，不得进入 promoted current truth
- 但 handoff consumer 默认只把这批产物标记为 `staged`
- 只有显式 promote，且 coverage/chunk-audit/release gate 全部通过，才允许它们进入 registry current truth
- `muc_public_pages` 的 promoted/released truth 只接受高信号正文页；listing / generic 噪音由 promote/release gate fail-close
- cleaning / chunking 的 page-family 规则以 `docs/policies/official-web-cleaning-and-chunking-policy.md` 为准
- 如果 inventory triage 已把某页标记为 `future_fresh_news_surface`，它只能继续作为 current-truth regression/local-validation seed，而不能被当成 stable-reference gate 的待升格页面

## 执行顺序

`project -> validate -> chunk audit` 必须串行执行，不能并行跑：

- validator 依赖 replay 产出的 `projection-report.json` 与文档目录
- chunk audit 依赖 validator 已确认当前 batch 的 emitted document 形状有效
- 本 runbook 不接受“先并行跑完再人工比对”的批次收口方式

1. 先确认 source-truth QC gate 已通过。

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-qc-batch-a --json
pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-batch-a \
  --json
```

2. 运行 local projection replay。

```bash
uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth \
  --output-dir /tmp/official-web-qc-batch-a \
  --projection-output-dir /tmp/official-web-qc-batch-a-projection
```

3. 运行 projection validator。

```bash
uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir /tmp/official-web-qc-batch-a-projection
```

4. 在 import / release 之前，先做本地 cleaning + chunking 审计。

```bash
uv run --all-packages campus-ingestion-audit-official-web-projection-chunking \
  --projection-output-dir /tmp/official-web-qc-batch-a-projection
```

这一步只审计本地 `canonical.md` / `document-units.jsonl -> chunk` 质量，不写 registry truth，也不写 Qdrant。

当前这层 audit 重点拦截两类常见 listing 噪音：

- portal/tab 样式短标签残留
  例如新闻首页或频道页正文区里的 `教学科研 / 校园经纬 / 全球合作`
- 被截断的 teaser / summary 行
  例如以 `...` 或 `…` 结尾的摘要残片
- 尾部 teaser/card 聚合簇
  例如专题入口后面拼接的 `24张...`、`媒体名 | 标题` 一类 teaser 行
- 首页/门户 listing 被单条 headline 污染成统一 section path
  例如整页 chunk context 都带着某一条头条新闻标题
- 清洗后 `row_ids` 仍保留已删掉的 short-label / teaser 行
  例如 `clean_text` 只剩 1-2 条有效标题，但 `row_ids` 还挂着 4-5 个来源行

除此之外，批次收口还要显式区分：

- `audit_only`
  - 允许进入 replay 输出与 chunk audit
  - 不允许进入 promote/release truth
  - 当前 scope 下的低价值招聘 / 采购 / 公示 `article_detail` 页面也属于这一类
- `promotable`
  - 允许参与 handoff promote 与 release candidate
  - 必须主要来自 `article_detail`、`directory_page`、稳定说明型 `generic_content_page`

`muc_public_pages` 批次收口还要进一步区分：

- `release_gate_required`
  - stable-reference-like answer-quality gate
- `retain_inventory_only`
  - 保留在 current truth，但不进入当前 gate，也不进入 future fresh-news seed set
- `future_fresh_news_surface`
  - 保留在 current truth，只服务 regression / local validation / future fresh-news handoff
  - 具体 seed set 以 `docs/reference/official-web-fresh-news-surface-handoff.md` 为准

5. 按批次类型完成收口。

- stable regression gate
  - 记录这轮 replay / validator 已通过
  - 不把这轮通过表述成 host 扩面或 scheduler promotion
- low-budget expansion batch
  - 补一份 repo-tracked reference note，写清 host、budget、family counts、抽样结论
  - 明确该 host 只是 validated expansion batch result，不自动进入 `scheduler-policy.json`
  - 如果这轮还要验证 import / handoff，再回到
    [official-web-collector-smoke-and-audit.md](./official-web-collector-smoke-and-audit.md)
    第 2 节继续执行 `drain-projection` 与本地 handoff consumer；否则默认到 projection validator 为止

6. 如果该批次要继续做 `muc_public_pages` 本地质量闭环，再执行：

```bash
uv run --all-packages python -m campus_ingestion_worker.official_web_projection_import \
  --projection-output-dir /tmp/official-web-qc-batch-a-projection \
  --replay-input-dir /tmp/official-web-qc-batch-a \
  --work-dir /tmp/official-web-qc-batch-a-import \
  --corpus official_web \
  --collection muc_public_pages \
  --require-promotable

uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection muc_public_pages \
  --no-publish-alias

uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/official_web_muc_public_pages_retrieval_qrels.json \
  --output /tmp/official-web-live-retrieval.json \
  --force-enable-retrieval \
  --qdrant-collection-name <physical-collection> \
  --format json

uv run --all-packages python -m campus_evals.official_web_live_benchmark run \
  --reruns 1 \
  --qdrant-collection-name <physical-collection> \
  --output-dir /tmp/official-web-live-gate
```

7. 如果当前 batch 要继续做首条 `stable_reference` bootstrap 闭环，则改为执行 routed scope import / release：

```bash
uv run --all-packages python -m campus_ingestion_worker.official_web_projection_import \
  --projection-output-dir /tmp/official-web-qc-batch-a-projection \
  --replay-input-dir /tmp/official-web-qc-batch-a \
  --work-dir /tmp/official-web-qc-batch-a-import-stable-reference \
  --corpus official_web \
  --collection stable_reference \
  --require-promotable

uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection stable_reference \
  --no-publish-alias

uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json \
  --output /tmp/official-web-stable-reference-live-retrieval.json \
  --force-enable-retrieval \
  --qdrant-collection-name <physical-collection> \
  --format json

uv run --all-packages python -m campus_evals.official_web_live_benchmark run \
  --reruns 1 \
  --official-web-scope stable_reference \
  --qdrant-collection-name <physical-collection> \
  --output-dir /tmp/official-web-stable-reference-live-gate

# optional only after local validation is accepted
uv run --all-packages python -m campus_ingestion_worker.scope_alias \
  --corpus official_web \
  --collection stable_reference \
  --physical-collection-name <physical-collection>
```

补充约束：

- `release_registry_scope` 默认使用 `--no-publish-alias`，避免误把本地验证结果发布成 serving alias
- `official_web_live_benchmark` 只允许显式传入 physical collection 名称；它会临时 monkeypatch runtime profile 做本地验证，但不会改写 repo-tracked `offline_preparation` truth
- `official_web_projection_import --require-promotable` 现在只会导入 `promotable` 子集；`audit_only` 文档会被跳过，并回写到 import report 的 skipped 列表
- 当前 `muc_public_pages` 的 low-value recruitment / procurement / public-notice `article_detail` 页面虽然能 replay 出 canonical document，但仍必须留在 staged audit truth，不参与 promote / release
- `stable_reference` bootstrap import 只消费 routed `target_collection=stable_reference` 文档，不允许顺手把 mixed bridge 页一起刷进这次 release
- `stable_reference` bootstrap release 在本地验证阶段默认仍先 `--no-publish-alias`；若 retrieval/live gate 已通过，再用 `campus_ingestion_worker.scope_alias` 单独执行 alias publish，避免把“生成 physical collection”和“切 serving alias”混成一步
- `stable_reference` retrieval/live-gate baseline 现在使用独立的 split manifest、retrieval qrels 与 `--official-web-scope stable_reference` deterministic live profile，不再复用 mixed `muc_public_pages` live gate
- `fresh_news` 当前也已有独立的 split manifest、retrieval qrels 与 `--official-web-scope fresh_news` seed live profile；但 runtime truth 仍保持 `offline_preparation`，不得把本地 seed 验证写成 query-open 结论

## 输出形态

projection replay 当前会写出：

- `projection-report.json`
- `documents/<target_corpus>/<target_collection>/<doc-dir>/canonical.md`
- `documents/<target_corpus>/<target_collection>/<doc-dir>/document-units.jsonl`

这一步的 contract 是：

- replay 只读取 `source-truth-bundle.json`、`page-manifest.json`、`content-blocks.jsonl`
- 不返回 raw HTML 重做 source extraction
- shell family 不自动落正文文档

## 通过标准

- 当前 batch 中出现的每个 `pageFamily` 都有 declaration
- `manual_review` 只来自 shell family
- `projection-report.json.counts.emitted_documents > 0`
- validator `errors = 0`
- chunking audit `passed = true`
- 任意抽样文档都同时存在 `canonical.md` 和 `document-units.jsonl`
- `document-units.jsonl` 中的 `doc_id` / `version_id` 与 report 一致

## 人工抽样重点

- `article_detail`
  正文标题、正文段落和来源 URL 是否保留
- `listing_page`
  列表项是否作为 listing/navigation 文档保留下来，而不是被吞成空文档
  portal/tab 短标签、摘要截断行、聚合 quick-link 行、尾部 teaser cluster 是否已被清掉
  这类文档即使清洗通过，也默认只应作为 audit material，而不是 release truth
- `directory_page`
  联系方式、机构名、电话号码等是否还在
  是否已经形成单实体/单联系方式组语义，而不是整页名单堆积
- shell 页
  是否仍然只落在 `manual_review`，没有被误投成正文文档

## 当前阶段禁止事项

- 不把 projection replay 结果直接当 retrieval truth
- 不把一次 expansion batch replay 通过直接写成 scheduler / hot lane 结论
- 不把 shell 页为了“过关”硬编码成 host-specific extract hack
- 不把 document/chunk/index 逻辑放回 `apps/official-web-collector`
