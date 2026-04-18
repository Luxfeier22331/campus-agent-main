# Phase 16 Research: OCR 资产分类与双渠道择优路由

## External Findings

1. **Classifier-first routing is a mature document-processing pattern**
   Azure Document Intelligence explicitly separates classification from downstream extraction, recommends confidence-threshold-based routing, and suggests adding an `other` class when unknown document types are expected. For this repo, that supports a dedicated asset-typing stage before OCR provider selection instead of a single global provider default.

2. **MinerU is designed for complex structured documents, not just plain OCR**
   MinerU official docs position the Precision Extract API for complex layouts and multimodal content, recommend the `vlm` model, expose async task polling plus `full_zip_url`, and support PDF, images, `doc/docx`, and `ppt/pptx`. This matches the repo’s observed strength on long structured PDFs and some complex tables.

3. **PaddleOCR-VL remains strong on document element parsing and irregular localization**
   Paddle’s official docs position PaddleOCR-VL as a production-oriented document parsing model that supports complex elements and, as of PaddleOCR-VL-1.5, irregular-shaped bounding box localization. That aligns with keeping Paddle in the routing set rather than treating MinerU as an unconditional replacement.

4. **Office-document support is a real future opportunity, but not a drop-in canonical switch today**
   MinerU supports Office formats in its extract API, and Azure’s classifier docs also support Office types including Excel. But the current repo’s raw-asset registration, object storage assumptions, and canonical normalization lanes are still PDF/image-centric. Office support should therefore be treated as a follow-up enabled by asset typing, not as immediate Phase 16 canonical scope.

## Local Validation Findings

1. **MinerU is already good enough to justify a first-class routing path**
   Across three local compare rounds, MinerU repeatedly won on:
   - long structured PDF output cleanliness
   - the repeated `pdf-351896` failure family where Paddle returned `done -> resultUrl 404`
   - the wide/colored schedule sample `d59bb244e7c1`

2. **MinerU is not yet safe as a global canonical provider**
   The clean contact-table image `attachment-0002.png` produced empty MinerU output twice while Paddle succeeded twice. That single repeated false negative is enough to block a global canonical switch.

3. **Spatially dominant assets remain outside OCR canonical truth**
   Both providers only produce partial labels and noisy fragments on map-like inputs. More OCR text is not equivalent to usable spatial truth. This repo should not let OCR text output define map semantics.

4. **Provider reliability belongs in the routing decision, not just text-quality scoring**
   The repeated Paddle `done -> resultUrl 404` cases prove that routing cannot be based only on extracted text or benchmark accuracy. Provider availability and artifact fetch integrity must be part of adjudication.

## Repo Implications

### 1. Raw asset typing has to move into the raw layer

The repo currently lacks the metadata needed to drive routing. Phase 16 should add and persist fields such as:

- `content_type`
- `file_extension`
- `byte_size`
- `page_count`
- `image_width`
- `image_height`
- `asset_kind`
- `asset_subkind`
- `classification_confidence`

These belong in the raw-asset layer and raw-asset registry truth, not in shared supervisor/retrieval contracts.

### 2. Routing must remain provider-neutral downstream

Phase 16 should not invent a second canonical document truth per provider. Provider outputs can remain separate artifacts, but source truth must stay canonical and provider-agnostic.

### 3. Dual-run compare should be selective, not universal

The user’s current quota makes broad dual-run feasible operationally, but the right architecture is still selective dual-run:

- ambiguous asset type
- high-value asset class
- known provider failure family
- validation tranche sampling

Running both providers for everything would blur truth, waste budget, and hide the real need for stable routing criteria.

### 4. Winner selection needs structure-aware adjudication

`plain_text_length` is insufficient. Phase 16 should judge provider outputs using:

- hard failure vs success
- empty output vs usable output
- structure preservation for tables
- wrapper/noise inflation
- provider fetch-contract integrity

### 5. Conditional canonical admission is the practical target

The best next-state for this repo is:

- `MinerU primary candidate` for text-dominant PDFs and whitelisted complex table images
- `Paddle fallback / primary` for simple table images and untyped images
- `deferred` for spatial assets and Office files until raw/document normalization no longer assume PDF-first semantics

## Recommended Plan Breakdown

- **16-01**: freeze raw asset typing fields, inference lifecycle, and provider-neutral routing contract
- **16-02**: upgrade compare lane into adjudication evidence, not just side-by-side dump
- **16-03**: implement conditional canonical routing plus fallback boundaries
- **16-04**: run tranche validation and explicitly decide what becomes MinerU canonical

## External References

- MinerU Precision Extract API: https://mineru.net/doc/docs/index_en/
- PaddleOCR-VL: https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html
- Azure Document Intelligence custom classifier: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept-custom-classifier?view=doc-intel-4.0.0
