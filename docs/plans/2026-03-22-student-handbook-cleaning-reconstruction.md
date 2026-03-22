---
doc_type: plan
status: active
created: 2026-03-22
updated: 2026-03-22
---

# Student Handbook 清洗重构实施文档

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `student_handbook` 从“单个 OCR provider 结果直接对应单个 document”的错误建模，重构为“provider 原始 OCR 结果 -> 内部统一 structured -> 多逻辑文档 -> 文档内结构化 chunking”的正确清洗与 ingestion 链路。

**Architecture:** 这轮 handbook 的主输入是当前 OCR 产物 `provider-result.jsonl`，而不是原始 PDF，也不是历史 `derived` 里的 `jsonl`。链路先把 provider 原始结果归一化成内部统一 page-level structured format，再按 handbook split manifest 恢复多篇制度文档边界，对每篇文档生成稳定 `doc_id` / `version_id` / canonical metadata，最后在单文档内部做 `article_body`、`policy_page`、`table`、`table_row` 的 structure-first chunking；历史 `derived` 产物只作为参考样本和验收对照。

**Tech Stack:** Python 3.12, uv workspace, unittest/pytest, JSON, Markdown, existing `campus_ingestion_core`, current OCR provider result schema, existing `campusRAG` student handbook canonical conventions

---

## 摘要

这次 handbook 清洗重构的边界固定为：

- 主输入是当前 OCR 运行产物 `provider-result.jsonl`
- 不直接处理 PDF 原始文档
- 不直接把 provider 原始响应当最终 structured truth
- 不直接使用历史 `derived/by_doc/*.jsonl` 或 `chunks.jsonl` 作为输入真相
- 必须先把 provider 结果归一化成内部 structured format
- 再恢复逻辑文档边界
- 再做文档内 chunking

当前已确认的 source-level OCR 产物示例路径：

- `campus-rag-processed/student_handbook/assets/student-handbook-pdf/sha256/b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-result.jsonl`

当前已确认的历史参考产物位于：

- `campusRag/rag-data/derived/runs/.../structured/student_handbook/by_doc/*.jsonl`
- `campusRag/rag-data/derived/runs/.../structured/student_handbook/chunks.jsonl`

这些历史 `derived` 产物只能用于：

- 参考目标字段形状
- 对照文档切分效果
- 对照 unit / chunk 结构
- 帮助建立回归测试

这些历史 `derived` 产物不能用于：

- 作为新链路的输入真相
- 直接回灌 registry
- 直接绕过 provider-to-structured 归一化步骤

## 目标模型

`student_handbook` 的正确分层固定为：

1. `provider source`
   - 当前 OCR 运行生成的 `provider-result.jsonl`
   - 保留供应商原始响应，不在这里直接做长期文档建模
2. `normalized structured source`
   - 从 provider 结果解析出的内部统一 structured rows
   - 最低粒度是 page-level / source-level rows
   - 这是 split 和 cleaning 的直接输入
3. `logical documents`
   - 从 handbook 全量 structured source 中恢复出的多篇制度文档
   - 每篇文档有独立 `document_id`、`title`、`source_uri`、`page_start`、`page_end`
4. `canonical cleaning output`
   - 每篇文档落一份稳定 canonical markdown 或等价结构化中间产物
   - metadata 只保留长期真相字段，不混入运行态字段
5. `structured units`
   - `article_body`
   - `policy_page`
   - `table`
   - `table_row`
6. `chunks`
   - 只在文档内部切分
   - 不跨文档切
   - 不把整份 handbook OCR source 当成 chunking 单位

## 非目标

- 不把 handbook 直接改造成和 `curriculum_plan` 完全相同的 profile
- 不在这轮引入第二套 handbook retrieval 语义
- 不在未冻结 handbook 文档边界前重做 eval case
- 不为了兼容现有错误模型保留长期双路径
- 不把 `campusRAG` 的历史 `derived` 结果原样整体搬运进来作为输入
- 不把 raw PDF 读取、OCR 调度、清洗重构三者强耦合成单一入口

## 参考真相

实现时以以下材料作为 handbook 清洗重构的参考：

- 当前 source-level OCR 输入：
  - processed 层 `provider-result.jsonl`
- handbook 真相结构参考：
  - `campusRag/docs/rag/student-handbook-canonical-schema.md`
  - `campusRag/rag-data/canonical/student_handbook/docs/*.md`
- handbook 历史结构样本参考：
  - `campusRag/rag-data/derived/runs/init-local/from_canonical=working/structured/student_handbook/by_doc/*/*.jsonl`
  - `campusRag/rag-data/derived/runs/init-local/from_canonical=working/structured/student_handbook/chunks.jsonl`
- handbook 清洗 / chunking 行为参考：
  - `campusRag/packages/rag-core/src/campusrag/pipelines/ingest/build_structured_from_clean_markdown.py`
  - `campusRag/tests/unit/test_student_handbook_canonical_splits.py`
  - `campusRag/tests/contracts/test_student_handbook_schema_metadata.py`
  - `campusRag/tests/unit/test_handbook_chunking_strategy.py`

规则上优先级固定为：

1. 当前 OCR provider 原始结果是输入事实
2. repo-tracked handbook split manifest 是文档边界真相
3. canonical schema 是清洗输出真相
4. 历史 `derived` 结果只是参考，不是输入真相

## 实施前冻结项

在开始正式改动前，先冻结 handbook 的以下输入：

- 清洗主输入是当前 `provider-result.jsonl`
- 第一步必须先把 provider 结果归一化成内部 structured rows
- split / cleanup 只消费内部 structured rows，不直接消费 raw provider payload
- handbook document truth 改为“多逻辑文档”
- `doc_id` 不再由 source 文件名派生，改为由规范化标题稳定生成
- `page_start/page_end` 必须是 document truth 的一部分，而不是事后推断字段
- canonical metadata 不记录 OCR 运行态字段
- chunking 只能发生在单篇逻辑文档内部
- 历史 `derived` 产物只能用于参考与回归测试，不作为新链路输入

## 数据面重构原则

- provider truth、structured truth 和 document truth 分层保存
- split boundary 是 handbook ingestion 的前置步骤，不是 chunking 的一部分
- document identity 由标题驱动，version identity 由文档正文驱动
- handbook 的 title / page range / section / doc_no 必须可追溯回内部 structured 结果
- raw PDF 和 provider 原始响应只作为 provenance，不参与 document identity
- provider parser 和 canonical cleaning 分开，避免把供应商字段直接污染长期真相
- 现有错误建模优先替换，不新增长期兼容层

## 推荐清洗方案

### Phase A: Provider 归一化

输入：

- `provider-result.jsonl`

输出：

- `structured-full.jsonl` 或等价内部统一 structured source

规则：

- 每一页至少归一化出：
  - `source_pdf`
  - `page_start`
  - `page_end`
  - `clean_text`
  - `provider_page_id`
  - `ocr_provider`
  - `ocr_model`
- 如果 provider 结果里存在块级 / 行级结构，统一折叠为可重放的内部 row schema
- provider 专有字段允许保留在原始 provenance 文件，不允许泄漏到 canonical front matter

### Phase B: 文档边界恢复

输入：

- `structured-full.jsonl`
- `split-manifest.v1.json`

输出：

- 每篇 handbook 文档的 source-level structured rows

规则：

- split manifest 是页段切分真相
- 每篇文档必须有独立 `title`、`page_start`、`page_end`
- 切分后先做标题核对：
  - manifest title
  - OCR 提取标题
  - 历史 canonical 标题参考
- 标题不一致时允许进入人工校验队列，但不自动并文

### Phase C: 文档级 canonical cleaning

输入：

- 单篇文档的 structured rows

输出：

- 单篇文档 canonical markdown
- 单篇文档 metadata

规则：

- 清除页眉页脚、重复页码、明显 OCR 噪声
- 标准化标题和文号
- 尽量保留章/节结构
- 把 `第X条` 提升为条款级结构
- 没有稳定条文结构时退化为 `policy_page`
- 产出 `doc_id = handbook:sha1(normalized_title)`

### Phase D: 文档内 unit 化与 chunking

输入：

- 单篇文档 canonical / structured result

输出：

- `article_body`
- `policy_page`
- `table`
- `table_row`
- 文档内 chunks

规则：

- chunking 只在单篇文档内部进行
- `article_body` 不跨文档
- `table` / `table_row` 独立保留
- oversize 条文按 token guardrail 切段并写 `root_unit_id` / `segment_index` / `segment_total`

### Phase E: 参考对照与验收

输入：

- 新链路输出
- 历史 `derived/by_doc/*.jsonl`
- 历史 `derived/chunks.jsonl`

输出：

- 结构对照报告
- 差异列表
- 可接受偏差说明

规则：

- 只做 shape 和语义对照，不直接复用历史数据
- 允许字段名收敛和 metadata 去噪
- 不允许出现历史正确分文档在新链路中被并回单文档

## 实施任务

### Task 1: 冻结 handbook provider 输入与 split config

**Files:**
- Create: `configs/ingestion/student_handbook/README.md`
- Create: `configs/ingestion/student_handbook/split-manifest.v1.json`
- Create: `configs/ingestion/student_handbook/canonical-profile.json`
- Modify: `configs/ingestion/` 下相关 README 或索引文件（如存在）
- Test: `tests/ingestion/test_split_manifest.py`

**Implementation:**
- 新增 `student_handbook` 专属 config 目录。
- `split-manifest.v1.json` 至少包含：
  - `manifest_version`
  - `corpus`
  - `provider_source_id`
  - `source_pdf`
  - `documents[]`
- `documents[]` 每项至少包含：
  - `document_id`
  - `title`
  - `page_start`
  - `page_end`
  - `source_uri`
  - `handbook_section`
  - `policy_doc_no`
  - `status`
- `canonical-profile.json` 冻结：
  - `doc_id_strategy = title_hash`
  - `version_id_strategy = canonical_body_hash`
  - `source_doc = 学生手册_2018.pdf`
  - `heading_profile = handbook_v1`
  - `primary_input = provider_result_jsonl`
- README 里明确写：
  - 当前主输入是 `provider-result.jsonl`
  - 历史 `derived` 结果只作参考

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_split_manifest.py -q`

### Task 2: 建立 provider-to-structured 归一化层

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py`
- Create: `tests/ingestion/test_handbook_provider_normalize.py`

**Implementation:**
- 新增 provider 结果归一化器，专门把 `provider-result.jsonl` 转成内部统一 `structured-full.jsonl`。
- 内部 row schema 至少包含：
  - `source_pdf`
  - `page_start`
  - `page_end`
  - `clean_text`
  - `provider_page_id`
  - `ocr_provider`
  - `ocr_model`
- 对 provider 缺页、空页、非 JSON 行做显式报错。
- 允许保留 provider 原始 payload 的引用，但不允许直接沿用 provider 字段做下游 identity。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_handbook_provider_normalize.py -q`
- 覆盖：
  - provider JSONL 可归一化为 page-level rows
  - 空结果报错
  - 页码顺序稳定
  - provider 专有字段不泄漏进 canonical metadata

### Task 3: 建立 handbook 清洗与文档拆分器

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py`
- Create: `tests/ingestion/test_handbook_cleanup.py`

**Implementation:**
- 输入为内部统一 structured rows 和 split manifest。
- 输出为逐文档 canonical cleaning 结果，而不是直接输出整份 OCR source 的单 document JSONL。
- 每篇文档的清洗至少完成：
  - 只保留本篇页码范围内的 structured 行
  - 清理页眉页脚、重复页码、明显噪声
  - 标准化标题行与文号行
  - 把 `第X条` 提升为条款级结构
  - 尽量保留章/节结构
  - 提取并隔离 HTML table 或 OCR table 结构
- 对缺失条文结构的短制度文档，允许退化为 `policy_page`
- 对无法稳定识别标题的文档，记录失败并进入 import report，不自动并到相邻文档

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_handbook_cleanup.py -q`
- 覆盖：
  - 相邻制度文档不会串文
  - 单页制度文档可以独立落盘
  - `policy_doc_no` 可从正文中抽出
  - 结构化条文缺失时退化为 `policy_page`
  - 表格不混入普通正文 clean_text

### Task 4: 建立 handbook canonical metadata 模型

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/handbook_canonical.py`
- Create: `tests/ingestion/test_handbook_canonical.py`

**Implementation:**
- 建立轻量 handbook canonical builder。
- 定义 `StudentHandbookCanonicalDocument`，字段至少包含：
  - `document_id`
  - `title`
  - `source_doc`
  - `handbook_section`
  - `page_start`
  - `page_end`
  - `policy_doc_no`
  - `body_markdown`
- 固定 `document_id` 规则：
  - `document_id = "handbook:" + sha1(normalized_title)`
- 固定 canonical front matter 真相字段：
  - `schema_version`
  - `doc_id`
  - `corpus`
  - `title`
  - `source_kind`
  - `source_doc`
  - `handbook_section`
  - `page_start`
  - `page_end`
  - `policy_doc_no` 可选
- 禁止把以下字段写进 canonical metadata：
  - `version_id`
  - `chunk_id`
  - `source_url`
  - `ocr_provider`
  - `ocr_model`
  - `acl`
  - `anchor`

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_handbook_canonical.py -q`

### Task 5: 重构 handbook structured ingestion 路径

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/split_manifest.py`
- Modify: `tests/ingestion/test_process_raw_ingestion_job.py`

**Implementation:**
- 去掉 handbook ingestion 的“一份 provider/source 直接生成一个 `handbook:{slug}` document”逻辑。
- `INGESTION_CORPUS=student_handbook` 时，要求显式提供 `INGESTION_SPLIT_MANIFEST_PATH`。
- handbook ingestion 主流程改为：
  - 读取 `provider-result.jsonl`
  - 归一化为内部 `structured-full.jsonl`
  - 按 handbook split manifest 逐文档清洗
  - 逐文档生成 `structured.jsonl`
  - 逐文档写 registry
- provider 原始结果保留为 provenance
- handbook 的 `version_id` 不再等于整份 provider/source 的 hash；document version 由 canonical body hash 或 split result hash 决定
- `processed_object_keys` 必须至少保留：
  - source-level `provider-result.jsonl`
  - source-level `structured-full.jsonl`
  - document-level `structured.jsonl`

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py -q`

### Task 6: 对齐 existing OCR 导入与新 structured ingestion 语义

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/existing_ocr_import.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
- Modify: `tests/ingestion/test_import_campusrag_existing_ocr.py`

**Implementation:**
- 让 `import_campusrag_existing_ocr` 和新 structured ingestion 收敛到同一 handbook document truth。
- 新增一致性约束：
  - existing OCR 导入的 `doc_id`、`page_start/page_end`、`source_pdf` 必须能被 handbook manifest 或 canonical truth 解释
  - 如果 existing OCR 的 `doc_id` 与 canonical title hash 不一致，直接报错，不隐式迁就
- 把 handbook 专有 metadata 绑定逻辑集中到一个 builder，避免 existing/new 两条路径各自拼 metadata

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_import_campusrag_existing_ocr.py -q`

### Task 7: 重构 handbook chunking 前置边界

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/process.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/chunking.py`
- Modify: `tests/ingestion/test_processing_pipeline.py`
- Create: `tests/ingestion/test_handbook_chunking_pipeline.py`

**Implementation:**
- 保留 handbook 的 `structure_first` chunking，但明确它发生在“单篇逻辑文档”内部。
- chunking 输入改为 handbook cleanup 后的单文档 `structured.jsonl`。
- 固定 handbook 结构单元：
  - `article_body`
  - `policy_page`
  - `table`
  - `table_row`
- `article_body` 只承载单篇制度文档内部的条文，不允许跨文档拼接。
- `policy_page` 仅作为“无稳定条文结构时”的回退单元。
- `table` / `table_row` 继续保留为单独 evidence 单元。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_handbook_chunking_pipeline.py -q`

### Task 8: 建立历史参考对照测试

**Files:**
- Create: `tests/ingestion/test_handbook_reference_alignment.py`

**Implementation:**
- 用历史 `derived/by_doc/*.jsonl` 和 `chunks.jsonl` 只做参考对照测试。
- 对照项只包含：
  - 文档边界是否正确
  - `page_start/page_end` 是否合理
  - `unit_type` 分布是否符合预期
  - 条文结构是否被保留
- 不把历史结果当真相，也不要求逐字段完全一致。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_handbook_reference_alignment.py -q`

### Task 9: 更新架构文档与 phase-1 假设

**Files:**
- Modify: `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- Modify: `docs/plans/agentic-rag-foundation.md`
- Modify: `apps/ingestion-worker/README.md`
- Modify: `README.md`

**Implementation:**
- 把 handbook 从“默认单 document”修正为“provider result -> structured -> 多逻辑 document”。
- 明确 handbook 的前置步骤是 `provider-result -> normalize -> split -> cleanup -> canonical -> chunking`。
- 删除或收紧以下错误假设：
  - handbook provider 结果直接输出单 `document_id`
  - handbook 无需 split manifest
  - handbook `document_id` 可以从文件名直接推导
  - 历史 `derived` 可以直接作为新链路输入

**Verification:**
- 文档交叉引用完整
- handbook 数据面描述与当前输入边界一致

### Task 10: 跑通仓库级回归并冻结验收口径

**Files:**
- Modify: `tests/ingestion/test_process_raw_ingestion_job.py`
- Modify: `tests/ingestion/test_import_campusrag_existing_ocr.py`
- Modify: `tests/ingestion/test_processing_pipeline.py`
- Modify: `tests/evals/test_golden_cases.py` 仅在 handbook `doc_id` 变更影响 case 时调整

**Implementation:**
- 先修 ingestion 与 cleaning 回归，再决定是否需要小幅调整 eval fixtures。
- 冻结 handbook 重构后的最小验收标准：
  - handbook split truth 已显式配置
  - 新链路主输入是 `provider-result.jsonl`
  - 历史 `derived` 只作为参考，不作为输入
  - canonical export 可人工审查
  - 单篇制度文档可独立建索引
  - chunk 不跨文档

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_split_manifest.py tests/ingestion/test_handbook_provider_normalize.py tests/ingestion/test_import_campusrag_existing_ocr.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_handbook_canonical.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_handbook_reference_alignment.py -q`
- `uv run --all-packages python -m unittest discover -s tests -t .`

## 验收标准

完成后以下条件必须同时成立：

- `student_handbook` 的 provider truth、structured truth 与 document truth 已正确分层
- handbook 不再走“一份 provider/source 结果一个 document”的错误路径
- handbook 每篇制度文档都有稳定 `document_id`、`title`、`page_start/page_end`
- 历史 `derived` 结果只参与参考对照，不参与输入
- canonical metadata 不包含 OCR 运行态字段
- handbook chunking 只在单篇制度文档内部发生
- handbook 表格证据可以独立保留
- 文档边界、identity 规则、version 规则、清洗产物和测试门禁都有 repo-tracked 真相

## 风险

- 如果 provider 结果本身结构噪声很大，provider-to-structured 归一化会成为主要误差源
- 如果 manifest 页码边界先验错误，cleanup 会稳定地产出错误文档，需要人工审校
- 如果历史 `derived` 本身含旧清洗偏差，参考对照要防止把旧偏差误当标准
- 如果 eval 或 retrieval fixture 隐式依赖旧 `document_id`，重构后会出现连锁回归

## Deferred

以下内容不在本轮 handbook 清洗重构中完成：

- handbook 之外其他 corpus 的 canonical profile 统一化
- 通用 canonical schema 框架抽象
- 基于 LLM 的自动标题纠错或自动页段对齐
- 面向运营同学的 handbook 可视化审校工具
- 多版本学生手册并存时的生命周期治理
