---
doc_type: plan
status: active
created: 2026-03-22
updated: 2026-03-22
---

# Student Handbook OCR Normalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `student_handbook` 从“单个 OCR provider 结果直接入库为单 document”的错误链路，重构为 `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> canonical.md + document-units.jsonl -> chunking` 的 phase-1 正确实现。

**Architecture:** handbook 的主输入固定为 processed 层 OCR 产物 `provider-response.jsonl`。实现上先新增 asset-level provider normalization contract，再把文档边界恢复、canonical cleaning、document-level `document-units.jsonl` 生成接入 `raw_ingestion`，最后用回归测试锁住 identity、page range、unit typing 和 object-store artifact shape。

## Migration note
本计划在 `regulations` 架构统一前撰写，它的正文还把 `student_handbook` 作为长期 corpus 定位并使用旧的 `revision_track` 术语。当前主线要求长期语义使用 `corpus + collection`，processed bucket 语义收敛为 `{corpus}/sources/{source_channel}/{source_asset_slug}/{year}/{ingest_id}/...` 与 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/...`，`student_handbook` 仅作为 collection/source-set 标签存在，原 `revision_track` 语义已改为 `representation`。请在引用此计划时把路径和命名替换为最新架构，以避免把旧路径误当作现行真相。

**Tech Stack:** Python 3.12, uv workspace, unittest/pytest via `uv run --all-packages`, JSON/JSONL, existing `campus_ingestion_core`, `split_manifest`, object store / registry integration, handbook canonical conventions from `campusRAG`

---

## Scope

本计划只覆盖 `student_handbook` ingestion truth 的重构，不改变 query-serving 默认语料范围，也不引入新的 retrieval 行为。

本计划以 [student-handbook-ocr-normalization-strategy.md](/home/reptilian/code/campus-agent/docs/architecture/student-handbook-ocr-normalization-strategy.md) 为设计输入，以现有 [phase1-ingestion-and-storage-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/phase1-ingestion-and-storage-architecture.md) 的 phase-1 边界为上层约束。

## Preconditions

- 当前主输入是 processed 层 `provider-response.jsonl`，不是 raw PDF。
- handbook 是“单 PDF 多逻辑文档”。
- `layout-elements.jsonl` 是 asset-level normalization contract。
- `split-manifest.v1.json` 是 handbook document boundary truth。
- document-level `document-units.jsonl` 继续是 chunking 的直接输入。
- 历史 `campusRAG` `derived/*.jsonl` 只用于字段形状参考和回归对照，不能直接作为新链路输入。

## Execution Order

按下面顺序执行，不要并行跨越未冻结的 contract：

1. 先冻结 handbook config / schema truth。
2. 再建立 provider normalization。
3. 再做 split + cleanup + canonical identity。
4. 再接 raw ingestion。
5. 最后收口 chunking、对照测试和文档。

## Task 1: 冻结 handbook config truth

**Files:**
- Create: `configs/ingestion/regulations/student_handbook/README.md`
- Create: `configs/ingestion/regulations/student_handbook/split-manifest.v1.json`
- Create: `configs/ingestion/regulations/student_handbook/canonical-profile.json`
- Create: `configs/ingestion/regulations/student_handbook/chunk-profile.json`
- Modify: `configs/ingestion/regulations/student_handbook/runtime-profile.json`
- Test: `tests/ingestion/test_split_manifest.py`
- Test: `tests/ingestion/test_corpus_runtime_profile.py`

**Step 1: 写 handbook config 失败测试**

- 在 [test_split_manifest.py](/home/reptilian/code/campus-agent/tests/ingestion/test_split_manifest.py) 增加 `student_handbook` manifest fixture 读取测试。
- 在 [test_corpus_runtime_profile.py](/home/reptilian/code/campus-agent/tests/ingestion/test_corpus_runtime_profile.py) 增加 handbook runtime profile 要求 split manifest 的断言。

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_split_manifest.py tests/ingestion/test_corpus_runtime_profile.py -q
```

Expected:

- 因缺少 `configs/ingestion/regulations/student_handbook/split-manifest.v1.json`
- 或 runtime profile shape 与测试不一致而失败

**Step 3: 最小实现**

- 新建 handbook config README，明确：
  - 主输入是 `provider-response.jsonl`
  - `layout-elements.jsonl` 是 split 前的唯一内部 truth
  - `split-manifest.v1.json` 是文档边界真相
- 增加空的 repo-tracked `split-manifest.v1.json` 骨架。
- 增加 `canonical-profile.json`，冻结：
  - `doc_id_strategy=title_hash`
  - `version_id_strategy=canonical_body_hash`
  - `primary_input=provider_result_jsonl`
  - `structured_source=structured_full_jsonl`
- 增加 `chunk-profile.json`，说明 chunking 输入是 document-level `document-units.jsonl`。
- 如有必要，收紧 `runtime-profile.json` 使 handbook 也显式要求 split manifest。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_split_manifest.py tests/ingestion/test_corpus_runtime_profile.py -q
```

**Step 5: 提交**

```bash
git add configs/ingestion/regulations/student_handbook tests/ingestion/test_split_manifest.py tests/ingestion/test_corpus_runtime_profile.py
git commit -m "feat: 冻结 handbook 清洗配置真相"
```

## Task 2: 建立 provider-to-structured normalization contract

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py`
- Create: `tests/ingestion/test_handbook_provider_normalize.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/__init__.py`

**Step 1: 写 normalization 失败测试**

- 新建 [test_handbook_provider_normalize.py](/home/reptilian/code/campus-agent/tests/ingestion/test_handbook_provider_normalize.py)。
- 覆盖以下场景：
  - 非 JSON line 报错
  - provider 页缺失或页码不连续时报错
  - 每页至少生成一行 source-level structured row
  - 输出字段至少包含 `source_pdf`、`page_start`、`page_end`、`row_type`、`text_raw`、`text_normalized`、`provider_page_id`、`ocr_provider`、`ocr_model`
  - table / heading 不会被抹平成普通 paragraph

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_provider_normalize.py -q
```

Expected:

- `ModuleNotFoundError`
- 或 normalization 函数未实现

**Step 3: 最小实现**

- 在 [handbook_provider_normalize.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py) 新增：
  - provider line 解析
  - asset-level source row schema builder
  - 轻量 `text_normalized` 规则
  - `row_type/block_role` 统一映射
  - source-level `layout-elements.jsonl` 序列化函数
- 只做 provider-agnostic normalization，不生成 `doc_id/version_id`。
- 导出公共入口给后续 `raw_ingestion` 调用。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_provider_normalize.py -q
```

**Step 5: 提交**

```bash
git add packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py packages/ingestion-core/src/campus_ingestion_core/__init__.py tests/ingestion/test_handbook_provider_normalize.py
git commit -m "feat: 添加 handbook provider 归一化层"
```

## Task 3: 建立 split + cleanup + canonical identity

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py`
- Create: `tests/ingestion/test_handbook_cleanup.py`
- Create: `tests/ingestion/test_handbook_canonical.py`

**Step 1: 写 cleanup / canonical 失败测试**

- 在 [test_handbook_cleanup.py](/home/reptilian/code/campus-agent/tests/ingestion/test_handbook_cleanup.py) 覆盖：
  - 相邻制度文档不会串文
  - 单页文档可独立落盘
  - 标题从首屏标题候选中稳定抽取
  - 缺少稳定条文结构时退化为 `policy_page`
  - table 单元不混入正文 `clean_text`
- 在 [test_handbook_canonical.py](/home/reptilian/code/campus-agent/tests/ingestion/test_handbook_canonical.py) 覆盖：
  - `doc_id = handbook:sha1(normalized_title)`
  - `version_id` 由规范化 `title + body` 生成
  - canonical metadata 只保留 `title/source_doc/page_start/page_end/policy_doc_no/handbook_section`

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_handbook_canonical.py -q
```

**Step 3: 最小实现**

- 在 [handbook_cleanup.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py) 新增：
  - split-manifest 投影到单文档 source rows
  - 标题候选决策
  - 页眉页脚/页码噪声清理
  - `policy_doc_no` 抽取
  - `canonical.md` builder
  - document-level `document-units.jsonl` builder
  - title-hash `doc_id` 和 canonical-body-hash `version_id`
- 不引入兼容双路径；handbook 直接按新 truth 输出。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_handbook_canonical.py -q
```

**Step 5: 提交**

```bash
git add packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_handbook_canonical.py
git commit -m "feat: 添加 handbook 文档拆分与 canonical 清洗"
```

## Task 4: 接 raw ingestion 主链路

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- Modify: `tests/ingestion/test_process_raw_ingestion_job.py`
- Modify: `tests/ingestion/test_processing_pipeline.py`

**Step 1: 写 raw ingestion 失败测试**

- 在 [test_process_raw_ingestion_job.py](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py) 增加 handbook 场景：
  - 缺少 `INGESTION_SPLIT_MANIFEST_PATH` 时失败
  - 成功路径会落 asset-level `provider-response.jsonl`
  - 成功路径会落 asset-level `layout-elements.jsonl`
  - 成功路径会按 manifest 逐文档写 `document-units.jsonl`
- 在 [test_processing_pipeline.py](/home/reptilian/code/campus-agent/tests/ingestion/test_processing_pipeline.py) 增加 handbook 每篇逻辑文档独立写 registry 的断言。

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py -q
```

**Step 3: 最小实现**

- 修改 [raw_ingestion.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py)：
  - `INGESTION_CORPUS=regulations` 且 `INGESTION_COLLECTION=student_handbook` 时要求 split manifest
  - 在线 OCR 返回后先走 handbook provider normalization
  - 写 asset-level `provider-response.jsonl` 与 `layout-elements.jsonl`
  - 再按 manifest 逐文档 cleanup，生成 document-level `document-units.jsonl`
  - 逐文档调用 registry 持久化，而不是把整份 handbook 当一个 document
- 保持 `provider_only` 与 `normalized` 的 phase-1 artifact 语义清晰，不新增临时兼容层。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py -q
```

**Step 5: 提交**

```bash
git add packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py
git commit -m "feat: 接入 handbook 新版 raw ingestion 链路"
```

## Task 5: 收口 handbook document-level chunking

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/process.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/chunking.py`
- Create: `tests/ingestion/test_handbook_chunking_pipeline.py`

**Step 1: 写 chunking 失败测试**

- 新建 [test_handbook_chunking_pipeline.py](/home/reptilian/code/campus-agent/tests/ingestion/test_handbook_chunking_pipeline.py)。
- 覆盖：
  - `article_body` 只在单 document 内分段
  - `policy_page` fallback 保持 token guardrail
  - `table` / `table_row` 保持独立 evidence 单元
  - oversize split 会写 `root_unit_id`、`segment_index`、`segment_total`、`split_reason`

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_chunking_pipeline.py -q
```

**Step 3: 最小实现**

- 在 [process.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/process.py) 保证读取的是 document-level `document-units.jsonl`。
- 在 [chunking.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/chunking.py) 明确 handbook 固定单元：
  - `article_body`
  - `policy_page`
  - `table`
  - `table_row`
- 不允许把多文档 source rows 当成一个 chunking 输入。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_processing_pipeline.py -q
```

**Step 5: 提交**

```bash
git add packages/ingestion-core/src/campus_ingestion_core/process.py packages/ingestion-core/src/campus_ingestion_core/chunking.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_processing_pipeline.py
git commit -m "feat: 收口 handbook 文档内 chunking 约束"
```

## Task 6: 建立 handbook reference alignment 回归

**Files:**
- Create: `tests/ingestion/test_handbook_reference_alignment.py`

**Step 1: 写 reference alignment 失败测试**

- 新建 [test_handbook_reference_alignment.py](/home/reptilian/code/campus-agent/tests/ingestion/test_handbook_reference_alignment.py)。
- 测试输入使用本地构造 fixture，不直接消费历史 `campusRAG derived` 作为 pipeline 输入。
- 断言：
  - 新链路输出的标题和页段与参考 canonical truth 一致
  - 相邻制度文档不会串文
  - 单页制度和多页制度都能保留独立 identity
  - 可接受偏差仅限 provider 噪声引起的轻微文本差异，不包括文档边界漂移

**Step 2: 运行失败测试**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_reference_alignment.py -q
```

**Step 3: 最小实现**

- 增加参考对照 fixture 和辅助断言函数。
- 如有必要，在 cleanup/canonical builder 上补最小修正，让输出满足对照门槛。

**Step 4: 运行测试到通过**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_reference_alignment.py -q
```

**Step 5: 提交**

```bash
git add tests/ingestion/test_handbook_reference_alignment.py
git commit -m "test: 添加 handbook 参考对照回归"
```

## Task 7: 更新运行时和仓库文档

**Files:**
- Modify: `apps/ingestion-worker/README.md`
- Modify: `README.md`
- Modify: `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- Modify: `docs/plans/agentic-rag-foundation.md`

**Step 1: 写 docs consistency 检查项**

- 列出必须同步修正的旧假设：
  - handbook 无需 split manifest
  - handbook provider 结果可直接变成单一 document
  - handbook `document_id` 可从文件名直接生成
  - 历史 `derived` 可直接作为新链路输入

**Step 2: 手工更新文档**

- 在 [apps/ingestion-worker/README.md](/home/reptilian/code/campus-agent/apps/ingestion-worker/README.md) 明确 handbook 与 curriculum_plan 一样，需要 asset-level `layout-elements.jsonl`。
- 在 [phase1-ingestion-and-storage-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/phase1-ingestion-and-storage-architecture.md) 明确 handbook 的前置步骤是 `provider-response -> layout-elements -> split -> cleanup -> canonical.md + document-units -> chunking`。
- 在 [agentic-rag-foundation.md](/home/reptilian/code/campus-agent/docs/plans/agentic-rag-foundation.md) 收紧 phase-1 ingestion 假设。
- 如 README 有旧表述，一并修正。

**Step 3: 提交**

```bash
git add apps/ingestion-worker/README.md README.md docs/architecture/phase1-ingestion-and-storage-architecture.md docs/plans/agentic-rag-foundation.md
git commit -m "docs: 更新 handbook OCR 重构后的运行时约束"
```

## Task 8: 仓库级验证

**Files:**
- No code changes expected

**Step 1: 运行 handbook 局部验证**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest \
  tests/ingestion/test_split_manifest.py \
  tests/ingestion/test_corpus_runtime_profile.py \
  tests/ingestion/test_handbook_provider_normalize.py \
  tests/ingestion/test_handbook_cleanup.py \
  tests/ingestion/test_handbook_canonical.py \
  tests/ingestion/test_process_raw_ingestion_job.py \
  tests/ingestion/test_handbook_chunking_pipeline.py \
  tests/ingestion/test_handbook_reference_alignment.py \
  tests/ingestion/test_processing_pipeline.py -q
```

**Step 2: 运行仓库级基线**

Run:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .
```

**Step 3: 处理失败项**

- 若失败来自旧 handbook 单 document 假设，优先修边界，不新增兼容层。
- 若失败来自 fixture 老化，更新 fixture 使其表达新 document truth。

**Step 4: 最终提交**

```bash
git add .
git commit -m "feat: 完成 handbook OCR 归一化与拆分链路重构"
```

## Exit Criteria

- handbook 主输入固定为 processed 层 `provider-response.jsonl`
- asset-level `provider-response.jsonl` 与 `layout-elements.jsonl` 分层保存
- `student_handbook` 必须通过 `split-manifest.v1.json` 恢复多逻辑文档
- 每篇制度文档独立生成 `doc_id`、`version_id`、`page_start/page_end`
- document-level `document-units.jsonl` 只承载单文档 `article_body/policy_page/table/table_row`
- `raw_ingestion` 是唯一支持的 handbook OCR ingestion truth 入口
- 历史 `campusRAG` 结果仅作参考对照，不作输入
- handbook chunking 只发生在单篇逻辑文档内部
- handbook 相关局部测试和仓库基线验证通过

## Risks

- provider 实际 payload 若和预期差异过大，Task 2 可能先需要补一层 provider adapter
- manifest 页段若本身有误，cleanup 会稳定产出错误文档
- old fixture 若隐式绑定单-document handbook，会在 Task 4-7 集中暴露
- handbook 表格噪声若重，`table` 与正文分离规则可能需要额外迭代

## References

- [student-handbook-ocr-normalization-strategy.md](/home/reptilian/code/campus-agent/docs/architecture/student-handbook-ocr-normalization-strategy.md)
- [phase1-ingestion-and-storage-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/phase1-ingestion-and-storage-architecture.md)
- [2026-03-22-student-handbook-cleaning-reconstruction.md](/home/reptilian/code/campus-agent/docs/plans/2026-03-22-student-handbook-cleaning-reconstruction.md)
- `/home/reptilian/code/campusRag/docs/rag/student-handbook-canonical-schema.md`
- `/home/reptilian/code/campusRag/packages/rag-core/src/campusrag/pipelines/ingest/build_structured_from_clean_markdown.py`
