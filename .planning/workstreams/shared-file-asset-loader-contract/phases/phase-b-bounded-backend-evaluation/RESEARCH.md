---
phase: "B"
name: "Bounded Backend Evaluation"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Research

## Goal

在 Phase A 已冻结的 contract posture 内，把 shared file asset loader 的剩余技术选型收口成可直接供 Phase C / Phase D 消费的 backend decision truth。

这份研究只回答 4 个问题：

1. legacy binary Office 的 conversion baseline 和 operator contract 应该是什么。
2. modern OOXML 的 deterministic extraction 首个实现路线应该是什么。
3. `MinerU` 和 `Paddle` 在 PDF / document-image / simple-image 间的 routing threshold 应该怎么切。
4. `semantic image` 什么时候才进入 multimodal enrichment。

## Standard Stack

### Legacy Binary Office

- canonical baseline:
  - dedicated conversion service
  - `JODConverter + LibreOffice`
  - normalized OOXML artifact
  - deterministic OOXML extraction
- stronger follow-up backend:
  - `Collabora Online REST`
- explicit rejects:
  - worker 进程内直接调用 `soffice --convert-to` 作为长期生产形态
  - 外部 conversion SaaS 作为默认 trunk
  - `Apache OpenOffice`

理由：

- `JODConverter` 官方文档明确把它定位为基于 LibreOffice / OpenOffice 的文档转换库，并提供 local/remote office manager 形态，适合作为服务边界而不是 shell 小工具。
- `Collabora Online` 官方文档明确提供 document conversion REST API，更适合作为后续更强产品化后端，而不是当前 Phase C 的最低闭环基线。
- 当前 repo 机器没有 `java` 和 `soffice`，所以 Phase C 不能假设宿主机预装转换依赖；这进一步要求 conversion 必须是独立 operator contract，而不是散落在 worker 内部的 shell 习惯。

### Modern OOXML

- `docx` entry choice:
  - `python-docx` 负责主文档体、段落、表格、基础 block structure 的结构化读取
  - package-level relations helper 负责 hyperlink / embedded-image refs / supplementary OOXML parts
- `xlsx` entry choice:
  - repo-owned SpreadsheetML ZIP/XML adapter
  - 显式处理 workbook / sheet / relationship graph / shared strings / formulas / cached values / merged cells / hyperlinks
- explicit rejects:
  - `openpyxl`
  - `xlrd`
  - OCR-first fallback
  - universal black-box parser

理由：

- Microsoft Learn 对 WordprocessingML / SpreadsheetML 的官方结构说明都把 `.docx/.xlsx` 定义为 ZIP package 内的确定性 XML part graph；这正好支持 package-first deterministic extraction，而不是把 OOXML 当成 OCR 目标。
- `python-docx` 官方文档表明它能直接访问段落、标题、表格、内联图片等 block-level / inline objects，适合作为 `docx` 主干入口。
- `xlsx` 在 repo 当前已经有 ZIP/XML 读取基础；Microsoft Learn 也明确 workbook、worksheets、shared string table、formula parts 都是 package 内稳定结构。Phase C 应该把这条能力提升成 shared adapter，而不是继续维持 source-specific helper，更不是引入 `openpyxl` 这类偏 authoring/round-trip 语义的依赖。

### PDF / Image

- complex PDF primary:
  - `MinerU`
- PDF salvage / simple OCR fallback:
  - `Paddle`
- simple image primary:
  - `Paddle`
- document-image with layout/table/read-order sensitivity primary:
  - `MinerU`
- semantic image:
  - multimodal enrichment only

理由：

- `MinerU` 官方文档强调其输出是面向 AI training / RAG / agent 的 Markdown 与 JSON，并覆盖 PDF、图片等复杂文档资产，适合承担 layout-aware document parsing 主 lane。
- `PaddleOCR` / `PP-StructureV3` 官方文档强调 OCR、版面分析、表格恢复和结构化输出，适合 simple OCR / salvage lane，也适合作为 image family 的轻量入口。
- repo 当前已同时接入 `MinerU` 与 `Paddle` provider client，Phase B 的任务不是“要不要引入”，而是把路由阈值固定下来。

## Architecture Patterns

### 1. Conversion-Then-Extraction

- legacy binary Office 不能直接进入 canonical extraction。
- 先产出 normalization artifact，再进入 OOXML deterministic extraction。
- normalized artifact 只是 derived artifact，不是新的 source truth。

### 2. Package-First Deterministic Parse

- 对 `.docx/.xlsx`，优先消费 package parts 和 relationships。
- 输出应该尽量保留结构语义，不压成单一长文本。
- parser 成功不等于 canonical success；仍要经过 repo-owned terminal outcome 语义判定。

### 3. Layout-Aware OCR Routing

- PDF / image 先按 layout complexity 和 extraction target 决定 lane。
- OCR provider 是实现手段，不是 asset family。
- multimodal 只能补充视觉语义，不能替代 canonical OCR/layout truth。

### 4. Fail-Close Terminal Semantics

- 无法高置信完成 conversion / extraction / routing 时，直接回落到现有 terminal outcomes：
  - `reference_only`
  - `manual_review_required`
  - `no_extractable_text`
  - `unsupported_binary`

## Decision Matrix

| Family | Chosen Entry | Why | Rejected Defaults |
| --- | --- | --- | --- |
| `.doc/.xls` | dedicated conversion service -> `JODConverter + LibreOffice` -> normalized OOXML | 把转换从 worker shell 习惯提升为 operator contract；后续还能切 `Collabora Online REST` | in-process `soffice`, external SaaS, `Apache OpenOffice` |
| `.docx` | `python-docx` + package relations helper | 直接消费 WordprocessingML block structure，保留 paragraphs/tables/headings/image refs | OCR-first, universal parser |
| `.xlsx` | repo-owned SpreadsheetML ZIP/XML adapter | 直接消费 workbook/sheet/shared strings/formulas/merged cells，符合 deterministic extraction | `openpyxl`, `xlrd`, flatten-to-text |
| PDF | `MinerU primary`, `Paddle salvage/fallback` | 复杂 PDF 需要 layout-aware 主 lane；Paddle 更适合 fallback / salvage | 单一路由到 Paddle，或把所有 PDF 交给 black-box parser |
| document image | `MinerU primary` | 需要版面、表格、阅读顺序 | 全量走 Paddle 或 multimodal |
| simple image | `Paddle primary` | 轻量 OCR 成本更低 | 全量走 MinerU 或 multimodal |
| semantic image | multimodal enrichment only | 价值在视觉关系本身，不是 OCR 文本本身 | 用 multimodal 覆盖 canonical extraction |

## Benchmark Rubric

### Hard Gates

- structure retention
  - `docx`: heading / paragraph / list / table block 边界是否保留
  - `xlsx`: workbook / sheet / row / merged-cell / formula / cached value 是否保留
- terminal outcome correctness
  - 失败是否显式落到 repo-owned terminal outcome
- provenance completeness
  - source ref、source sha256、engine/version、normalized artifact ref、warnings/failure reason 是否完整
- layout / read-order correctness
  - complex PDF / document-image 是否维持正确阅读顺序和表格边界

### Secondary Tradeoffs

- operator cost
  - 部署依赖、并发模型、资源占用、升级路径
- output richness
  - hyperlink refs、embedded-image refs、sheet metadata、table range fidelity
- salvage behavior
  - fallback lane 是否在不伪造成功的前提下带来实际收益

## Sample Matrix

Phase B 的最小 benchmark corpus 应按 asset family 固定，不用“随便找几个文件”代替：

| Sample Class | Minimum Coverage | Expected Focus |
| --- | --- | --- |
| `.doc` | 1 plain-text notice attachment, 1 table-heavy legacy attachment | conversion success/failure, normalized OOXML sanity |
| `.xls` | 1 simple sheet, 1 merged-cell/formula-heavy sheet | conversion completeness, workbook fidelity |
| `.docx` | 1 heading/list/table-rich document | block structure retention, hyperlinks/image refs |
| `.xlsx` | 1 workbook with shared strings, formulas, merged cells | sheet/table/formula/cached-value retention |
| born-digital PDF | 1 multi-page text/table PDF | layout/read-order accuracy under primary lane |
| scanned/layout-heavy PDF | 1 scan or multi-column sample | OCR + layout recovery |
| document image | 1 table/notice screenshot | layout-sensitive image routing |
| semantic image | 1 chart/diagram/photo-like sample | multimodal trigger correctness |

样本来源规则：

- 优先使用 repo 当前真实 source channels 能遇到的资产。
- 所有样本都要保留 provenance，不能把一次性本地文件路径冒充长期 truth。
- `authenticated_notice` attachment path 是首批 benchmark 样本来源，但 Phase B 不做 migration 实现。

## Routing Rules

### Legacy Binary Office

- `.doc/.xls` 一律先进入 conversion service。
- conversion 失败、输出缺失、结构不可信时，直接 fail-close。
- 不能回退到 worker 内临时 shell 命令，也不能静默改走 OCR。

### Modern OOXML

- `.docx/.xlsx` 一律优先走 deterministic structured extraction。
- 只有在 package 已损坏或内容确实不可提取时，才回落 terminal outcome。
- 不允许默认改走 OCR。

### PDF

- default:
  - `MinerU primary`
- route to `Paddle` only when:
  - 作为 salvage / fallback lane
  - 或明确是轻量 OCR probe，而不是 canonical 主路由

### Image

- `simple image -> Paddle`
  - 以简洁 OCR 为主，没有复杂表格/版面/阅读顺序要求
- `document image -> MinerU`
  - 有明显版面、表格、段块和阅读顺序要求
- `spatial/map-like image -> manual_review_required`
  - 当前 workstream 不把地图/空间图硬塞成 OCR 成功

### Semantic Image Multimodal Trigger

只有在以下条件同时成立时才进入 multimodal enrichment：

- 图像价值主要来自视觉关系，而不是可 OCR 文本本身
- 资产不承担 canonical document parsing 责任
- enrichment 结果可以作为 auxiliary artifact 挂在 provenance 下，而不是覆盖 canonical extraction

典型命中：

- 图表
- 流程图
- 信息图
- 照片类说明图

典型不命中：

- 普通扫描通知
- 表格截图
- 需要精确阅读顺序的 document image

## Don't Hand-Roll

- 不手写 legacy binary Office parser。
- 不把 `soffice --convert-to` 留在 worker 进程里当长期生产模式。
- 不引入第二套 source-specific terminal outcome 命名。
- 不重新把 `openpyxl`、`xlrd` 拉回 trunk design。
- 不把 multimodal 扩成默认 OCR/parser。
- 不让 provider 私有成功态直接等同 canonical success。

## Common Pitfalls

- 把“当前代码里已有 xlrd / 自写 xml helper”误当成 forward contract。
- 把 conversion dependency 预装在宿主机上当成默认前提。
- 把 PDF born-digital 文本可抽取误解成“不需要 layout-aware 主 lane”。
- 把 semantic image 与 document image 混成同一类。
- 为了命中率继续放宽 fallback，最终把 fail-close 语义打穿。

## Recommended Phase C Handoff

Phase C 应直接按下面的实现顺序推进：

1. 落 shared contract modules：
   - asset descriptor
   - normalization outcome
   - extraction outcome
   - terminal outcome
   - artifact provenance
2. 落 legacy binary Office conversion adapter：
   - service client
   - health/version/readiness
   - normalized artifact metadata
   - fail-close mapping
3. 落 modern OOXML adapters：
   - `docx` adapter: `python-docx` + relations helper
   - `xlsx` adapter: SpreadsheetML ZIP/XML shared adapter
4. 落 routing layer：
   - `MinerU primary`
   - `Paddle fallback/simple-image`
   - semantic-image multimodal trigger
5. 复用现有 terminal semantics，不新造词。

Phase C 还应显式承认当前本机环境事实：

- `java` absent
- `soffice` absent
- `docker` present
- `uv` present
- `pnpm` present

因此 conversion baseline 应优先设计成 service/container contract，而不是宿主机二进制假设。

## Sources

### Repo Local Truth

- `/home/reptilian/code/campus-agent/.planning/workstreams/shared-file-asset-loader-contract/REQUIREMENTS.md`
- `/home/reptilian/code/campus-agent/.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `/home/reptilian/code/campus-agent/.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/CONTEXT.md`
- `/home/reptilian/code/campus-agent/.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/PLAN.md`
- `/home/reptilian/code/campus-agent/docs/architecture/system/file-asset-loader-architecture.md`
- `/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `/home/reptilian/code/campus-agent/apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py`
- `/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `/home/reptilian/code/campus-agent/packages/ingestion-core/pyproject.toml`

### Official / Primary Sources

- JODConverter documentation:
  - https://jodconverter.github.io/jodconverter/latest/
- Collabora Online document conversion:
  - https://www.collaboraonline.com/document-conversion/
- MinerU documentation:
  - https://mineru.net/doc/docs/index_en/
- PaddleOCR documentation:
  - https://www.paddleocr.ai/main/en/index.html
- PaddleOCR PP-StructureV3:
  - https://paddlepaddle.github.io/PaddleOCR/v3.0.1/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html
- Microsoft Learn, WordprocessingML structure:
  - https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document
- Microsoft Learn, SpreadsheetML structure:
  - https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document
- Microsoft Learn, shared string table:
  - https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table
- Microsoft Learn, formulas:
  - https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas
- python-docx documentation:
  - https://python-docx.readthedocs.io/en/latest/index.html
  - https://python-docx.readthedocs.io/en/latest/user/api-concepts.html
  - https://python-docx.readthedocs.io/en/latest/dev/analysis/features/text/hyperlink.html

