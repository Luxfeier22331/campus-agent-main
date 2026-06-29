# muc_public official_web source config

This directory freezes the public-web source config for the `muc_public` site.

It defines source reachability, scheduler lanes, QC policy and target-first
consumer admission inputs. It does not open `fresh_news`, `news_archive`, or any
college-specific query-serving surface.

## Config Files

- `site.json`
  - site identity and shared request baseline
- `hosts.json`
  - host allowlist, host grouping, rollout order and host-scoped crawl policy
- `seeds.json`
  - public seed set for enabled hosts
- `crawl-policy.json`
  - shared URL admission and content-fetch policy
- `scheduler-policy.json`
  - lane identity, cadence, host scope and budget truth
- `qc-policy.json`
  - site-scoped QC allowlist for known review-only shell families
- `credentials.schema.json`
  - anonymous public crawl posture
- `projection-declarations.json`
  - page-family source-truth fan-out declarations
- `projection-routing.json`
  - retained legacy downstream scope override config; current routes stay empty
- `consumer-denominator.json`
  - downstream consumer denominator for retained source-truth candidates
- `target-source-map.json`
  - target-first admitted downstream surfaces
- `target-inventory.json`
  - operator-facing inventory truth for admitted target-first pages
- `source-packs/`
  - repo-tracked source-pack manifests for explicit target-first batches

## Scheduler Lanes

- `consumer-candidate-hot`
  - bounded hot lane for support/reference candidates on admitted
    university-level surfaces
- `consumer-stable-baseline`
  - daily baseline lane for school-level core/support consumer candidates
- `college-single-host-baseline`
  - disabled template for one-college validation
- `topic-single-host-baseline`
  - disabled template for one-topic validation
- `repair`
  - retry lane for failed observations without widening coverage

Passing an expansion batch does not change scheduler cadence or query-serving
scope. Hosts outside the stable regression gate must be admitted through
explicit source-pack or target workset inputs.

## Retention Rules

- fetched pages without downstream consumer evidence are rejected from retained
  source-truth in `retain_matching_only` mode
- listing pages are discovery by default
- contact/service candidates require extracted fact evidence before selected
  write
- notice/news candidates remain `inventory_only`
- public regulation candidates route to `regulations/institutional_rules` or
  `regulations/student_rules`

`projection-declarations.json` owns baseline `page_family -> action /
document_kind / default target scope`. `projection-routing.json` must not
independently open official-web serving surfaces.

## References

- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web.md`
- `docs/policies/official-web-crawl-policy.md`
