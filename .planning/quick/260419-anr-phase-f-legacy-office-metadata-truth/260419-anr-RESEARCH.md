# Quick Task 260419-anr Research

**Description:** authenticated-notice regulation consumption Phase F legacy Office / metadata truth planning  
**Mode:** quick-full

## Repo Facts

- 当前 non-auth workstream 是 `authenticated-notice -> regulation downstream consumption`，入口文档是 `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`。
- source projection 当前已经支持：
  - `docx -> text_extractable`
  - `xlsx -> text_extractable`
  - `xls -> text_extractable`
  - `pdf/image -> ocr_required`
- `.doc` 当前仍明确 fail-close：
  - `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
  - `tests/ingestion/test_authenticated_notice_source_projections.py`
- `xls` 当前通过 `xlrd` 读取；repo 已有依赖：
  - `packages/ingestion-core/pyproject.toml`
- `scoped_rules` 的 `school_unit_name` 已经按 title-first + fail-close 收紧，真实风险样本已补回归。
- 当前 stop point 仍固定在 `offline_preparation`；不进入 query-serving、embedding、Qdrant、release。

## External Facts

### 1. `.doc` 的成熟路线不是手写二进制 parser，而是先规范化

- Unstructured 官方文档明确写到 `partition_doc` 会先用 `libreoffice` 把 `.doc` 转成 `.docx`，再调用 `partition_docx`。
  - https://docs.unstructured.io/open-source/core-functionality/partitioning
- LibreOffice 官方文档明确提供 `--convert-to` 命令行转换能力，适合 headless 批量转换。
  - https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html

直接含义：

- 对 repo 来说，`.doc` 最自然的前向实现是 worker-owned normalization lane。
- 不需要在 `packages/ingestion-core` 里自写 legacy Word binary parser。

### 2. `.xlsx` 的成熟路线是 OOXML-aware reader，优先 read-only / lazy 模式

- openpyxl 官方文档把 `read_only=True` 作为大文件、近似常量内存读取的推荐路径。
  - https://openpyxl.readthedocs.io/en/3.1/optimized.html

直接含义：

- repo 当前自写的 OOXML zip/xml 读取已经能工作，但长期若要提升维护性，可以迁移到成熟 reader。
- 这不是当前最紧急缺口，因为 `xlsx` 已经是 supported truth，不应重开为 blocker。

### 3. `.xls` 继续用历史格式专用 reader 是合理的

- `xlrd` 官方 changelog 明确从 `2.0.0` 开始只支持 `.xls`。
  - https://xlrd.readthedocs.io/en/latest/changes.html

直接含义：

- repo 继续把 `.xls` 固定在 `xlrd` lane 是成熟且清晰的选择。
- 没必要为了统一格式去重写 `.xls` 读取，只需要在 provenance 和 docs truth 上收口。

### 4. 如果将来要引入通用 Office 提取栈，Tika 是成熟备选，但不是当前最小正确方案

- Apache Tika 官方文档说明其 `OfficeParser` / `OOXMLParser` 基于 Apache POI，支持 OLE2 和 OOXML 的文本与 metadata 提取。
  - https://tika.apache.org/3.1.0/formats.html

直接含义：

- Tika 是成熟备选，但会引入新的 Java/runtime 形态。
- 对当前 repo，这比 `worker-owned LibreOffice normalization -> 现有 source projection path` 更重，不适合作为 Phase F 的默认第一方案。

## Decision

Phase F 应冻结为：

1. 把 `xls/xlsx` 明确写回 supported truth，而不是继续挂在 gap 列表里。
2. 把 `.doc` 冻结为：
   - 当前 fail-close
   - 后续只允许经 worker-owned normalizer 进入现有 `text_extractable` path
3. normalizer 的默认实现优先 `LibreOffice --convert-to`：
   - 本地、headless、成熟
   - 不额外引入 Java service / remote parser
4. promotion/materialization 层继续 file-type agnostic，只消费 canonical document。
5. `.doc` 是否从“异常式 fail-close”升级为“可盘点 terminal outcome”需要单独裁决，但仍属于同一条 non-auth workstream。

## Rejected / Deferred

- 不把 `.doc` 直接静默当成 `.docx`
- 不在 repo 内手写 `.doc` 二进制 parser
- 不引入新的 Tika service 作为 Phase F 默认主方案
- 不把这条线扩成 auth owner recovery、query-serving reopen、release hardening
