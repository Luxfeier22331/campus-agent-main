# official_web source config

This tree holds repo-tracked source-level configuration for the `official_web`
source channel.

- `configs/sources/official_web/<site_id>/site.json`: site identity and shared
  runtime baseline
- `configs/sources/official_web/<site_id>/hosts.json`: host-level admission,
  crawl, robots policy, host grouping, and rollout order
- `configs/sources/official_web/<site_id>/seeds.json`: repo-tracked seed URLs
  and reasons
- `configs/sources/official_web/<site_id>/crawl-policy.json`: shared
  URL/content/frontier policy
- `configs/sources/official_web/<site_id>/scheduler-policy.json`: lane cadence,
  stable lane identity, host scope, and per-run budget policy
- `configs/sources/official_web/<site_id>/credentials.schema.json`: runtime
  secret shape only
- `configs/sources/official_web/<site_id>/projection-declarations.json`:
  downstream projection declarations

Host policy groups are source-layer segmentation only. They distinguish
university-level, college-level, topic, and excluded hosts inside the same
`official_web` source channel. They do not create new source channels, retrieval
collections, or query-serving surfaces.

Scheduler lanes use explicit `lane_id` values as stable operator/run keys.
Multiple lanes may share the same `run_intent` when their `lane_id` values are
different. Use `host_filter` and host-level `rollout_order` to keep university
pages first, then roll out college/topic hosts one at a time.

These files are source-channel truth. They are not collection runtime profiles.
