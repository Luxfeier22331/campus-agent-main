---
phase: "C"
artifact: "research"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase C Research

## Purpose

把 Phase B 的 backend choice 转成 Phase C 可执行的 implementation constraints，避免在 substrate implementation 时重新回到 parser/provider 选型争论。

## Official References Consulted

- `python-docx` quickstart:
  - https://python-docx.readthedocs.io/en/latest/user/quickstart.html
- Microsoft Learn / SpreadsheetML:
  - https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table
  - https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas
- JODConverter docs:
  - https://jodconverter.github.io/jodconverter/latest/configuration/local-manager/
- PaddleOCR PP-StructureV3 docs:
  - https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html
- MinerU docs:
  - https://mineru.net/doc/docs/index_en/
- Collabora Online conversion page:
  - https://www.collaboraonline.com/document-conversion/

## Implementation Readings

### OOXML extraction

- `python-docx` 直接暴露 paragraph / heading / table oriented document traversal，适合作为 `docx` deterministic extraction substrate，而不是重新手写低层 WordprocessingML 遍历。
- Microsoft Learn 明确了 SpreadsheetML shared string table 存在于 `sharedStrings.xml`，并说明 worksheet cell 在 `t="s"` 时通过 shared string index 引用文本；这与 repo 当前 `xlsx` 自写 ZIP/XML adapter 的方向一致。
- Microsoft Learn 同时明确了公式文本放在 `<f/>`，缓存值放在 `<v/>`。这意味着 forward adapter 至少要保留 formula text 与 cached/displayed value 的 distinction，不能只保留一个扁平字符串。

### Legacy Office normalization

- JODConverter `LocalOfficeManager` 提供 office process lifecycle、port/process manager/profile template 等运行约束，说明 production-grade conversion contract 应由 service adapter 承担，而不是让业务 worker 直接长期持有 `soffice --convert-to` 调度逻辑。
- Collabora Online conversion page表明其 REST conversion 能作为后续更强 backend，并且它与 JODConverter/LibreOffice 一样覆盖 Microsoft Office formats。这支持 repo 当前把 Collabora 继续放在 future hardening，而不是 Phase C 默认落点。

### PDF / image routing

- PaddleOCR PP-StructureV3 文档明确它面向 document parsing / table recognition，并建议非 Python 场景优先使用 service-based deployment；这与 repo 当前把 Paddle 放在 provider lane 而不是 package-level parser truth 的设计一致。
- MinerU 官方文档明确提供 `full_zip_url` 等 extract artifact，并支持 PDF / image 等输入。Phase C 无需扩展其 family scope，只需要把现有 admitted lane 抽象为 shared routing module 与 artifact contract。

## Conclusions For Phase C

1. `docx` shared adapter 可以直接以 `python-docx` 为 package-level structured reader。
2. `xlsx` shared adapter 继续走 repo-owned SpreadsheetML ZIP/XML reader，重点保留 shared strings、sheet graph、formula/cached value 语义。
3. legacy Office 需要 package-owned normalization seam；worker wrapper 只能降级为 runtime shell。
4. PDF/image shared substrate 以 current routing seeds 为基础收口，不重做 provider 选型。
5. multimodal 不在 Phase C 成为 canonical parse lane；最多只保留后续 enrichment seam。
