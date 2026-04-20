---
phase: "01.1"
artifact: "research"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 01.1 Research

## Purpose

把 `Bounded Service Navigation Multimodal Probe And Admission` 建立在两类事实之上：

- 官方当前支持的 image input / structured outputs / PDF input 能力边界
- 本地真实页段 `252-255` 的 OCR 对比与页图 probe 证据

## Official References Consulted

- OpenAI Images and Vision guide:
  - https://platform.openai.com/docs/guides/images-vision
- OpenAI Structured Outputs guide:
  - https://platform.openai.com/docs/guides/structured-outputs
- OpenAI PDF files guide:
  - https://platform.openai.com/docs/guides/pdf-files

## Repo Pattern Readings

- `docs/architecture/file-asset-loader-architecture.md`
- `packages/shared/src/campus_shared/prompt_runtime.py`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/PLAN.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/CONTEXT.md`
- `.tmp/campus-services-handbook-slice/compare/paddle/summary.json`
- `.tmp/campus-services-handbook-slice/compare/mineru/summary.json`
- `.tmp/campus-services-handbook-slice/compare/mineru/comparison.json`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-02.png`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-03.png`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-04.png`

## Official Capability Findings

### Image Inputs

- OpenAI 官方文档确认 Responses API 支持多图输入；同一请求里可以放多张页面图片，适合做 `252-255` 的受限页图 probe。
- 文档同时给出 `detail` 控制：
  - `low` 适合快速、低 token 的粗读
  - `high` 适合更细的页面阅读
  - `auto` 由系统决定
- 文档还明确说明，`gpt-5.4` 及后续模型支持 `detail: original`。对这条线的页面密集中文流程框，执行时应优先 `high`，只有在 `high` 仍不足以稳定读出框内正文时，才考虑 `original`。
- 文档列出了视觉局限，例如小字、旋转、密集布局仍可能不稳定。这与当前页段高度一致，因此必须有 fail-close 和人工复核位，不能把单次模型回答当成 canonical truth。

### Structured Outputs

- OpenAI 官方文档确认可以用 strict JSON Schema 约束输出形状，这正适合这条线的“只允许输出有限流程节点和边关系”需求。
- 官方文档同时给出关键限制：
  - 所有字段都应声明为 required
  - object schema 需要 `additionalProperties: false`
  - schema 应保持浅层、受限，避免过深或开放式对象
- 官方文档建议在 prompt 调整时配套 evals。这一建议应被翻译成当前 phase 的稳定性 gate，而不是直接跳到生产 materialization。

### PDF Inputs

- OpenAI 官方 PDF guide 明确说明 PDF 输入会同时提供 extracted text 和每页图像。
- 对本 phase，这既是能力，也是风险：
  - 能力：如果后续真的要做 bounded production materialization，bounded PDF 是可选输入形式。
  - 风险：当前要回答的是“多模态是否能补上 OCR 没恢复出来的流程框正文”，若直接喂 PDF，请求会混入 PDF text extraction，导致 admission 结论掺杂 OCR 文本贡献，无法判断 image understanding 的真实收益。
- 因此，本 phase 的 admission gate 不应直接用 bounded PDF 作为 probe 输入，而应使用从同一 bounded slice 渲染出的 per-page PNG。

## Local Evidence Findings

### OCR 双跑结论

- `Paddle` 输出 `plain_text_length=785`，`MinerU` 输出 `plain_text_length=764`，长度差不足以判定明确赢家。
- compare 结果为 `manual_review_required=true`，说明当前 canonical OCR lane 还不能稳定把这 4 页收口成可直接消费的流程正文。
- `MinerU` 输出中保留了更多 image reference；`Paddle` 输出中保留了更多 HTML-ish 包装，但两者都没有把流程框正文和箭头关系稳定 materialize 成可直接消费的 step graph。

### 页图 probe 结论

- page 253、254、255 的真实页图中，流程框正文肉眼清晰可读，说明 source 页面本身不是“不可读图像”。
- page 254、255 的主流程关系相对简单，适合当作 admission gate 的稳定页。
- page 253 也可读，但存在流程跨行和回折关系，因此更适合作为“是否需要 `manual_review_notes` 字段”的压力页。
- 这意味着当前缺口更接近：
  - OCR/layout parser 没有把图形化正文恢复出来
  - 而不是 source page 本身不可消费

## Repo Fit Findings

### This Is Compatible With Current Architecture

- `docs/architecture/file-asset-loader-architecture.md` 仍然规定：多模态 lane 不能默认替代 document image 的 OCR/layout parser canonical lane。
- 因此，这条线唯一成立的方式是：
  - 只把多模态用作 handbook-derived `service_navigation_document` 的 bounded admission gate
  - 如果后续 admission 通过，也只允许它成为这条 target-side materialization 的局部 lane，而不是 repo-wide parser default

### Existing Repo Helpers Already Match Official Guidance

- `packages/shared/src/campus_shared/prompt_runtime.py` 已经有 strict structured-output payload builder。
- 同一文件中的 `_close_json_schema_objects(...)` 会在 object schema 缺省时自动补 `additionalProperties: false`，与官方 Structured Outputs 要求一致。
- 这意味着后续若真的执行 Phase 2 hybrid lane，不需要再造一套 JSON-schema plumbing。

## Decisions Carried Into Planning

1. 本 phase 的 probe 输入固定为 bounded slice 渲染出的 per-page PNG，而不是直接上传 bounded PDF。
2. probe 输出必须是 strict JSON Schema，不接受自由文本总结型输出。
3. schema 只能表达：
   - 页面标题
   - 流程标题
   - 步骤文本
   - 显式 next-step 关系
   - 必要的人工复核备注
4. 多模态当前只被 admission 为“值得正式验证的 bounded candidate”，还不是已 admitted canonical lane。
5. 最终 admission outcome 必须依赖稳定性 gate，而不是依赖单次视觉效果或人工主观印象。

## Conclusions For Phase 01.1

1. 结合官方 docs 与本地页图证据，这条线适合做一次正式、受边界约束的多模态 admission gate。
2. 本 phase 的正确 probe 形式是：
   - 输入：`252-255` 页渲染 PNG
   - 输出：strict JSON schema
   - 目标：验证流程节点与边关系是否能稳定恢复
3. 当前证据足以否定“继续只调 OCR provider 就能自然收口”这一假设，但还不足以直接宣布 repo 接受新的默认多模态 parser lane。
4. `Phase 2` 是否保持 OCR-only，还是升级为 bounded hybrid materialization，必须等本 phase 的稳定性 gate 结果来决定。
