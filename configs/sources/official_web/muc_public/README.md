# muc_public official_web source config

This directory freezes the initial public-web source config for the `muc_public`
site.

- `site.json`: top-level site identity and shared request baseline
- `hosts.json`: explicit host allowlist, host grouping, rollout order,
  host-specific crawl policy, and optional host-scoped dynamic-shell discovery
  policy
- `seeds.json`: initial public seed set for enabled hosts
- `crawl-policy.json`: shared URL admission and content-fetch policy
- `scheduler-policy.json`: stable lane identity, cadence, host scope, and
  budget truth
- `qc-policy.json`: site-scoped QC allowlist for known review-only shell
  families
- `credentials.schema.json`: anonymous public crawl posture for v1
- `projection-declarations.json`: first-wave source-truth fan-out for the
  currently declared page families
- `projection-routing.json`: legacy downstream scope override config; current
  repo truth keeps it empty, and target-first source-pack / release-gate
  admission owns query-enabled scope promotion
- `consumer-denominator.json`: downstream consumer denominator for deciding
  which fetched pages are retained as source-truth candidates during recovery
- `target-source-map.json`: target-first admitted downstream surfaces,
  including split public regulation routing for `regulations/institutional_rules`
  and `regulations/student_rules`
- `target-inventory.json`: operator-facing inventory truth for admitted
  target-first pages
- `source-packs/`: repo-tracked one-time source-pack manifests; current default
  remains `tool-driven-first-slice.v1`, and expansion batches use explicit
  alternate source-pack ids instead of reopening broad crawl

Repo-level workflow split:

- stable regression gate: fixed 5-host regression surface for extractor / QC /
  replay stability; it is not the full allowlist truth
- low-budget expansion batch: one-off validation batch for already allowlisted
  hosts outside the stable gate; it must pass source-truth QC, `projection
  replay`, and projection `validator` before the host is treated as a validated
  batch result
- `scheduler-policy.json`: baseline / hot / repair lane cadence truth; passing
  one expansion batch does not mean the host should enter `hot lane`

Host rollout split:

- `university_core`: school-level entry surfaces. Current first-pass set is
  `www.muc.edu.cn`, `news.muc.edu.cn`, and `xxgk.muc.edu.cn`.
- `university_support`: school-level support surfaces kept behind target-first
  consumer lanes. Current set is `lib.muc.edu.cn`, `met.muc.edu.cn`, and
  `xiaoyou.muc.edu.cn`.
- `college`: college or institute-owned hosts. These are enabled source hosts
  but should be validated one host at a time before widening recurring lanes.
- `topic`: topic or campaign hosts. These are also one-host-at-a-time rollout
  candidates, separate from college ownership.
- `excluded`: known public hostnames that stay outside source-truth crawl
  admission, such as portal/service app shells.

Current scheduler lanes:

- `consumer-candidate-hot`: enabled bounded `hot` lane for contact, service
  guide, and stable-reference candidates on university-level surfaces,
  including target-first information-technology service pages.
- `consumer-stable-baseline`: enabled daily `baseline` lane for school-level
  core/support consumer candidates. Broad news crawl is not part of default
  recovery.
- `college-single-host-baseline`: disabled lane template for operator-triggered
  one-college validation; pass exactly one explicit `--host`.
- `topic-single-host-baseline`: disabled lane template for operator-triggered
  one-topic validation; pass exactly one explicit `--host`.
- `repair`: enabled `repair` lane for retrying failed observations without
  widening coverage.

The split is a source-layer crawl control mechanism only. It does not open
`fresh_news`, `news_archive`, or any college-specific query-serving surface.

Consumer-denominator recovery is stricter than host admission:

- fetched pages without downstream consumer evidence are rejected from retained
  source-truth in `retain_matching_only` mode
- listing pages are discovery by default, not answer-bearing evidence
- contact/service candidates require extracted fact evidence before selected
  write
- notice/news candidates remain `inventory_only` until a separate runtime
  opening admits them
- public regulation candidates are split conservatively:
  - `regulation_candidate` -> `regulations/institutional_rules`
  - `student_regulation_candidate` -> `regulations/student_rules`

Current public regulation collection posture:

- `tool-driven-first-slice.v1` remains the repo-tracked first batch and current
  default source-pack manifest
- larger student/public regulation expansion should use an explicit alternate
  manifest id, not mutate collector scope back into host-wide crawl
- student-work listing pages such as `xsgz/jwgl.htm`, `xsgz/xszz.htm`,
  `xsgz/xwsy.htm`, and `xsgz/jlycf/1.htm` are admitted only as one-time
  `same_host_manual_requeue` discovery rows

Current v1 declarations stay inside the existing quality-improvement scope:

- `article_detail` -> emitted as article-like canonical documents
- `listing_page` -> emitted as navigation/listing canonical documents
- `directory_page` -> emitted as directory/contact canonical documents
- `sitemap_navigation_page` -> retained as `manual_review`
- `data_table_page` -> retained as `manual_review`
- `gallery_page` -> retained as `manual_review`
- `contact_widget_page` -> retained as `manual_review`
- `generic_content_page` -> emitted as generic canonical documents
- `dynamic_shell_page` / `structural_shell_page` -> retained as `manual_review`,
  not auto-emitted

`projection-declarations.json` is the repo-tracked page families contract for
both the stable regression gate and any expansion batch. If a new batch surfaces
a family outside this declaration set, fix the declaration or batch scope before
treating it as validated.

`projection-routing.json` is a legacy document-level routing layer on top of
`projection-declarations.json`, but the current repo-tracked file intentionally
keeps `routes` empty:

- declarations still own the baseline `page_family -> action / document_kind /
  default target scope`
- routing must not independently open `official_web/stable_reference`,
  `official_web/fresh_news`, or `official_web/news_archive`
- query-enabled official-web scope admission must come from explicit
  target-inventory / source-pack / release-gate lineage
- everything else, including `retain_inventory_only`, stays on the mixed
  `official_web/muc_public_pages` bridge until a later phase moves it explicitly

Current host-scoped shell handling:

- `lib.muc.edu.cn` keeps the root shell page in `manual_review`
- the collector may still use browser-assisted discovery for that host to
  promote same-host detail/listing URLs back into the normal static source-truth
  lane
- the site QC policy allowlists known shell-family review findings so
  `qc-report` can pass without ad hoc CLI flags

Current expansion status:

- the stable regression gate still uses `www/news/xxgk/xiaoyou/lib`
- `law.muc.edu.cn` and `history.muc.edu.cn` are current-worktree validated
  expansion batch hosts
- validated expansion batch does not by itself change source config ownership,
  scheduler cadence, or query-serving scope
