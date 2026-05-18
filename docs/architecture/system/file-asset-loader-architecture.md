---
doc_type: architecture
status: active
created: 2026-04-19
updated: 2026-04-20
---
# Shared File Asset Loader Architecture

## 文档边界

本文冻结 repo 级 `shared file asset loader` supporting architecture。

它回答的是：

- repo 内 file-like asset 应该由谁统一负责
- shared contract 在 data plane 里处于哪一层
- 不同资产家族的 canonical handling lane 是什么
- remote API、self-hosted service 与 source-specific runtime 分别属于谁
- 什么情况下必须 `fail-close`

它不负责：

- 某个 source channel 的 source unit 定义
- 某个 collection 的 cleanup / chunking / promotion 细节
- 某次 benchmark、PoC 或 worktree-local 实现进度
- 把 page-level source-truth、notice-level source-truth 改写成“万能 parser”

## 设计目标

repo 要统一的是：

`asset typing -> optional normalization -> extraction -> terminal outcome ->
provenance`

不是：

- 统一成单一 parser 品牌
- 让 source-specific collector 继续各自拥有 parser truth
- 把 OCR、manual review 与 source projection 压平成单一黑盒

因此 `shared file asset loader` 的 canonical owner 固定为：

- `packages/ingestion-core`

`apps/*` 只允许承接：

- worker/runtime shell
- provider/client wiring
- bounded operator/CLI entry

不反向拥有 repo 级 file asset contract。

## 在 Data Plane 中的位置

对 file-like assets，repo 级 canonical chain 固定补充一条 shared subchain：

`raw/source object -> source-truth relation or file descriptor -> optional
normalization -> extraction/provider artifacts -> terminal outcome or canonical
child document artifacts -> document-units -> chunks -> index`

固定规则：

- 这条 subchain 只处理 file-like asset，不替代 source-specific source unit
- `official_web` 继续先有 page-level source-truth
- `authenticated_notice_portal` 继续先有 notice-level source-truth 与 attachment
  relation truth
- shared loader 只在 source-specific relation truth 已成立之后，负责 admitted file asset 的
  normalization / extraction / terminal outcome

## Canonical Contract Vocabulary

shared loader 至少要显式暴露以下 repo-owned nouns：

- `AssetDescriptor`
- `NormalizationOutcome`
- `ExtractionOutcome`
- `TerminalOutcome`
- `ArtifactProvenance`

最低 contract 语义固定为：

- 输入必须携带稳定的 asset family、source storage ref、mime/extension hints 与 upstream
  provenance
- 输出必须明确区分：
  - 是否发生 normalization
  - 是否产生可消费 extraction artifacts
  - 是否 materialize 成 canonical child document
  - 如果没有 materialize，终止在什么 terminal outcome
- 所有 derived artifacts 都必须带 engine/version/source-hash/warnings/failure-reason

## 资产家族矩阵

### Legacy Binary Office

范围固定为：

- `.doc`
- `.xls`

canonical 处理方式固定为：

- 先走 explicit conversion / normalization service
- 转成 admitted OOXML 后，再进入 deterministic extraction
- 如果转换失败或质量不可信，直接 `fail-close`

固定禁止：

- 在 `ingestion-core` 内手写 legacy binary parser
- 因为历史代码里已有局部路径，就把 `.doc` 和 `.xls` 继续拆成两套 owner

### Modern OOXML

范围固定为：

- `.docx`
- `.xlsx`

canonical 处理方式固定为：

- 走 deterministic OOXML parse
- 优先保留结构语义，而不是直接 flatten 成长文本

固定规则：

- `docx` 保留 heading / paragraph / list / table / hyperlink / embedded-image refs
- `xlsx` 保留 workbook / sheet / table range / headers / merged cells / formula /
  displayed value
- `xlsx` 的 retrieval / chunk view 以 sheet 或 table range 为主，不把整份 workbook
  压平成单一长文本

### PDF

canonical 处理方式固定为：

- PDF 不默认并入“纯文本 native extraction”总路径
- 复杂 PDF、扫描 PDF、多栏、表格密集、阅读顺序敏感 PDF 默认走 layout-aware document parsing lane
- born-digital PDF 可以保留轻量 probe 或 diagnostics，但不反向定义 canonical lane

当前 accepted backend posture：

- `MinerU` 是复杂 PDF 主候选 lane
- `Paddle` 是 PDF salvage / secondary lane，不是 PDF 默认总主路由

### Image

图片固定分成两类，不允许一刀切：

- `document image`
  - 文字、表格、版式、阅读顺序主导
- `semantic image`
  - 照片、图表、流程图、混合视觉语义主导

当前 accepted lane：

- 普通图片 / 简单 OCR：`Paddle` 主 lane
- 复杂表格图 / 文档图 / 版式敏感图片：`MinerU` 主 lane
- 多模态大模型 lane：只用于 `semantic image` enrichment，不替代 document image 的 OCR / layout
  parser

固定禁止：

- 把所有图片都直接送进多模态模型
- 用多模态结果覆盖低置信结构化提取

### Text-Like And HTML File Assets

对明确的 text-like 或 HTML file asset，固定优先：

- deterministic native parse

它们不应因为“统一 loader”而被错误送进 OCR lane。

## Provider And Deployment Posture

provider 选择与 deployment mode 是同一 contract 下的两个维度，不允许把它们混成资产分类规则。

固定规则：

- remote API 与 self-hosted service 只是 deployment mode，不是新的 asset family
- 上层 source-specific path 只依赖 shared contract，不依赖某个 provider 的私有 schema

### MinerU / Paddle

当前 accepted posture：

- `MinerU` 与 `Paddle` 允许走受信任的公开 API
- 是否 remote 不改变 canonical lane 的语义
- 后续若切到 self-hosted，同样必须复用同一 shared contract，而不是重建第二套 parser path

### LibreOffice-Family Conversion

对 legacy binary Office，默认 production posture 固定为：

- internal self-hosted conversion service

推荐形态：

- `JODConverter + LibreOffice` 作为首个自部署实现
- 后续可替换为 `Collabora Online REST` 等更强产品化后端

当前 repo-owned runtime contract：

- worker/core caller 只消费 `LEGACY_OFFICE_CONVERSION_BASE_URL`、`LEGACY_OFFICE_CONV
  ERSION_INTERNAL_SHARED_SECRET` 与 optional
  `LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`
- admitted service routes 固定为：
  - `POST /api/internal/legacy-office/conversions`
  - `GET /healthz`
  - `GET /readyz`
- internal admission 固定使用 `x-app-internal-auth`
- 当前 engine truth 固定为 `jodconverter+libreoffice`

固定禁止：

- 在业务 worker 里每次直接拉起 `soffice --convert-to` 作为长期生产形态
- 把外部 conversion SaaS 视为 canonical default

## Provenance And Fail-Close

固定规则：

- 原始对象始终保留为 source truth 的上游输入，不因 normalization 被覆盖
- 由 legacy binary Office conversion 生成的 `docx/xlsx` 只是 normalization
  artifact，不是新的 source truth
- 任何 lane 无法高置信完成时，都必须显式落到 repo-owned terminal outcome

当前 repo 级 terminal outcome family 继续允许包括：

- `reference_only`
- `pending_machine_processing`
- `no_adoption`
- `no_extractable_text`
- `unsupported_binary`

固定禁止：

- 猜测性补全文本
- 伪造空 document
- 把 provider 内部成功态直接等同于 canonical success

## Source-Specific Integration Boundary

### Official Web

- page-level source-truth 继续留在 `official_web` source channel
- page parser 不承担 linked/downloaded file asset 的长期 parser owner
- 如果 downstream 需要消费 page-linked file assets，必须进入 shared file asset loader
  contract

### Authenticated Notice

- notice-level source-truth 与 attachment relation truth 继续留在
  `authenticated_notice_portal`
- attachment objects 的 normalization / extraction / terminal outcome 不再属于
  collector 私有逻辑
- `authenticated_notice` attachment migration 是 shared loader 的首个优先接入面，但不反向改写
  notice source unit
- 当前已落盘的 authenticated notice admitted attachment default lane 只覆盖：
  - `doc`
  - `docx`
  - `xls`
  - `xlsx`
  - `pdf`
  - image OCR / terminal-outcome families
- `doc` / `xls` 先走 service-backed legacy Office normalization，再进入 deterministic
  OOXML extraction；生成的 `.docx/.xlsx` 继续只是 normalization artifact，不改写 source
  truth
- `file_asset_routing.py` 已是 PDF / image typed routing 的 canonical owner；历史
  `raw_asset_typing.py` / `online_ocr_routing.py` shim 已删除，不再保留 forward import
  surface

## 非默认主干

当前固定不作为 repo 默认主干：

- `Docling`
  - 资源要求过高，不作为默认全量 parser lane
- `OpenDataLoader`
  - 可作为 born-digital PDF 的补充或 benchmark lane，不作为统一资产主干
- `Apache OpenOffice`
  - 不作为 legacy Office conversion 基座

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/runbooks/legacy-office-conversion-runtime.md`
