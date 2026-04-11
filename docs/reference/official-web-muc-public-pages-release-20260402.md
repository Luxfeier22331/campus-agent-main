---
doc_type: reference
status: historical
created: 2026-04-02
updated: 2026-04-12
---

# official_web muc_public_pages Release Evidence (2026-04-02)

## Scope

This note records the first registry-backed Qdrant release lifecycle execution
for the currently imported `official_web/muc_public_pages` dataset.

It is evidence for:

- `offline_preparation` collection alias lifecycle closure
- manifest / validation-summary persistence
- current imported dataset quality sampling

It is not evidence for:

- `official_web/muc_public_pages` retrieval readiness
- opening `official_web` as a query-serving surface
- scheduler / hot-lane promotion

## Runtime Truth At Execution Time

- runtime profile: `configs/ingestion/official_web/muc_public_pages/runtime-profile.json`
- serving stage: `offline_preparation`
- retrieval enabled: `false`
- serving alias: `muc_public_pages`
- root env loaded from: `/home/reptilian/code/campus-agent/.env`
- registry scope count at execution time: `1`
- releasable record count at execution time: `1 active + is_current=true`

Current releasable registry record:

- `official_web:muc_public:generic_content_page:8d3531930a02365b3ad77364f3ad436f1b9af1b6`
- `official_web/documents/muc_public_pages/中央民族大学新闻网--8d353193/source-faithful/undated/document-units.jsonl`

## Verification Before Release

Executed:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_release_registry_scope_worker \
  tests.ingestion.test_corpus_runtime_profile \
  tests.retrieval.test_backend_qdrant
```

Result:

- `66` tests passed

## Preflight Release

Executed:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection muc_public_pages \
  --no-publish-alias
```

Result:

- release id: `r20260402_152018`
- physical collection: `muc_public_pages__r20260402_152018`
- previous alias target: `muc_public_pages__r20260402_082328`
- validation status: `passed`
- document count: `1`
- point count: `42`
- `published_at`: `null`

Artifacts:

- `official_web/releases/muc_public_pages/r20260402_152018/index-release.json`
- `official_web/releases/muc_public_pages/r20260402_152018/validation-summary.json`

## Published Release

Executed:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection muc_public_pages \
  --publish-alias
```

Result:

- release id: `r20260402_152206`
- physical collection: `muc_public_pages__r20260402_152206`
- previous alias target: `muc_public_pages__r20260402_082328`
- alias target after publish: `muc_public_pages__r20260402_152206`
- validation status: `passed`
- document count: `1`
- point count: `42`
- published at: `2026-04-02T15:22:17.607410+00:00`

Artifacts:

- `official_web/releases/muc_public_pages/r20260402_152206/index-release.json`
- `official_web/releases/muc_public_pages/r20260402_152206/validation-summary.json`

Validation summary payload:

```json
{
  "chunk_count": 42,
  "unit_type_counts": {
    "section_text": 42
  },
  "token_summary": {
    "min": 50,
    "max": 265,
    "avg": 73.86
  }
}
```

## Quality Sampling

Release validation passed, but sampled chunk content shows the current imported
dataset is still dominated by a listing/news aggregation page rather than a
high-value detail正文 page.

Observed sample properties:

- chunk count: `42`
- character length: `min=55`, `max=272`, `avg=79.2`
- repeated title prefix: `中央民族大学新闻网 / 校长强世功接受“统战新语”专访 解读民族团结进步促进法`
- many chunks are stacked headline/listing fragments rather than standalone正文

Representative samples:

```text
中央民族大学新闻网 / 校长强世功接受“统战新语”专访 解读民族团结进步促进法
从北京到边疆，从课堂到田野，一场关于“铸牢”教育的系统探索，正在中央民族大学稳步开展。
```

```text
中央民族大学新闻网 / 校长强世功接受“统战新语”专访 解读民族团结进步促进法
校领导拜会北京市委组织部领导交流高质量就业工作
```

```text
中央民族大学新闻网 / 校长强世功接受“统战新语”专访 解读民族团结进步促进法
中央民族大学党委举办树立和践行正确政绩观学习教育读书班
教学科研
校园经纬
全球合作
```

## Conclusion

Current truth after this execution:

- `official_web/muc_public_pages` has now closed the registry-backed release and
  alias lifecycle for the current imported dataset
- the collection remains `offline_preparation`
- retrieval/query-surface discussion remains closed
- the next work item is not more release plumbing; it is improving current
  imported dataset quality and reducing listing-heavy noise before broader
  import or any retrieval-opening discussion
