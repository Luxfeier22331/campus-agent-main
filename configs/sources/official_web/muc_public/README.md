## muc_public official_web source config

This directory freezes the initial public-web source config for the
`muc_public` site.

- `site.json`: top-level site identity and shared request baseline
- `hosts.json`: explicit host allowlist, host-specific crawl policy, and optional host-scoped dynamic-shell discovery policy
- `seeds.json`: initial public seed set for enabled hosts
- `crawl-policy.json`: shared URL admission and content-fetch policy
- `scheduler-policy.json`: baseline / hot / repair lane cadence and budget truth
- `qc-policy.json`: site-scoped QC allowlist for known review-only shell families
- `credentials.schema.json`: anonymous public crawl posture for v1
- `projection-declarations.json`: first-wave source-truth fan-out for the currently declared page families
- `projection-routing.json`: downstream scope override truth for the first corpus split bootstrap; unmatched pages still fall back to the declaration target scope

Repo-level workflow split:

- stable regression gate:
  fixed 5-host regression surface for extractor / QC / replay stability; it is not the full allowlist truth
- low-budget expansion batch:
  one-off validation batch for already allowlisted hosts outside the stable gate; it must pass source-truth QC, `projection replay`, and projection `validator` before the host is treated as a validated batch result
- `scheduler-policy.json`:
  baseline / hot / repair lane cadence truth; passing one expansion batch does not mean the host should enter `hot lane`

Current v1 declarations stay inside the existing quality-improvement scope:

- `article_detail` -> emitted as article-like canonical documents
- `listing_page` -> emitted as navigation/listing canonical documents
- `directory_page` -> emitted as directory/contact canonical documents
- `generic_content_page` -> emitted as generic canonical documents
- `dynamic_shell_page` / `structural_shell_page` -> retained as `manual_review`, not auto-emitted

`projection-declarations.json` is the repo-tracked page families contract for both the stable regression gate and any expansion batch. If a new batch surfaces a family outside this declaration set, fix the declaration or batch scope before treating it as validated.

`projection-routing.json` is the repo-tracked document-level routing truth layered on top of `projection-declarations.json`:

- declarations still own the baseline `page_family -> action / document_kind / default target scope`
- routing only overrides the downstream target scope for explicitly matched subsets
- current routing now splits:
  - stable-reference subset -> `official_web/stable_reference`
  - current fresh-news seed set -> `official_web/fresh_news`
- everything else, including `retain_inventory_only`, stays on the mixed `official_web/muc_public_pages` bridge until a later phase moves it explicitly

Current host-scoped shell handling:

- `lib.muc.edu.cn` keeps the root shell page in `manual_review`
- the collector may still use browser-assisted discovery for that host to promote same-host detail/listing URLs back into the normal static source-truth lane
- the site QC policy allowlists known shell-family review findings so `qc-report` can pass without ad hoc CLI flags

Current expansion status:

- the stable regression gate still uses `www/news/xxgk/xiaoyou/lib`
- `law.muc.edu.cn` and `history.muc.edu.cn` are current-worktree validated expansion batch hosts
- validated expansion batch does not by itself change source config ownership, scheduler cadence, or query-serving scope
