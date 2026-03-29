## curriculum_plan split gap triage

This triage is based on direct inspection of `/tmp/curriculum-layout-elements.v3.jsonl`.
It is retained as a historical note after the split-truth promotion decision.

### Historical repo facts

- The initial candidate gap list contained `16` legacy canonical documents.
- After minimal title normalization, only `1` legacy canonical document remained unresolved.
- The original main miss patterns were title normalization mismatches, not absent content.

### Gap classes

#### Class A: title exists, only punctuation normalization differs

These titles exist in `layout-elements.v3`, but current exact-match seeding misses them because OCR-cleaned titles use ASCII parentheses `()` while old canonical titles use full-width Chinese parentheses `（）`.

- `中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案`
- `俄语（俄语、中亚语）本科人才培养方案`
- `信息与计算科学（民族实验班）本科人才培养方案`
- `历史学（强基计划）本科人才培养方案`
- `哲学（强基计划）本科人才培养方案`
- `汉语国际教育（国际学生）本科人才培养方案`
- `环境科学（中外合作办学）本科人才培养方案`
- `美术学（美术教育师范）本科人才培养方案`
- `计算机科学与技术（民族实验班）本科人才培养方案`
- `音乐与舞蹈学类（舞蹈类专业）本科人才培养方案`
- `音乐与舞蹈学类（音乐类专业）本科人才培养方案`

Minimum fix:

- normalize titles with `NFKC` before exact matching

#### Class B: title exists, but OCR title has stable suffix drift

These titles exist in `layout-elements.v3`, but the cleaned source keeps a stable edition suffix not present in old canonical title strings.

- `民族学本科第二学士学位人才培养方案`
  - OCR title: `民族学本科第二学士学位人才培养方案(2020 版)`
- `社会学本科第二学士学位人才培养方案`
  - OCR title: `社会学本科第二学士学位人才培养方案(2020 版)`
- `文物与博物馆学本科第二学士学位人才培养方案`
  - OCR title: `文物与博物馆学本科第二学士学位人才培养方案(2020 版)`

Minimum fix:

- allow canonical title match after stripping a stable trailing edition suffix like `"(2020 版)"`

#### Class C: title exists, but current heading role is weaker than expected

- `法学（民族实验班）本科人才培养方案`
  - OCR title exists at page `339`
  - current role is `heading + paragraph_title`, not `doc_title`

Minimum fix:

- do not require `doc_title` role for split seeding
- exact normalized title hit anywhere in source rows should be sufficient

#### Class D: likely not a real split document under current cleaned source

- `各类课程教学计划`
  - no matching title row found in current `layout-elements.v3`
  - legacy page span `14-22` is a preface / generic curriculum-rule segment that overlaps with later concrete course-plan documents

Minimum fix:

- treat this as a manifest governance decision, not a title-normalization bug
- likely remove it from the real split document set unless the team explicitly wants a generic preface document

### Resolved promotion strategy

1. Update split seeding to match titles after `NFKC` normalization.
2. Add a small title canonicalization layer for stable suffix stripping:
   - trailing edition suffixes like `"(2020 版)"`
3. Accept exact normalized title hits regardless of whether the row role is `doc_title` or `paragraph_title`.
4. Re-run candidate generation.
5. Reclassify `各类课程教学计划` as a retired legacy umbrella document and exclude it from the formal split truth.

### Final decision

- The above minimum fixes auto-resolved `15/16` original gaps.
- The last legacy gap, `各类课程教学计划`, was resolved by governance review rather than by title matching.
- The formal `split-manifest.v1.json` therefore contains `66` source-visible documents and excludes the legacy umbrella label.
