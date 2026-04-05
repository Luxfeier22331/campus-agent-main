## official_web source config

This tree holds repo-tracked source-level configuration for the
`official_web` source channel.

- `configs/sources/official_web/<site_id>/site.json`: site identity and shared runtime baseline
- `configs/sources/official_web/<site_id>/hosts.json`: host-level admission, crawl, and robots policy
- `configs/sources/official_web/<site_id>/seeds.json`: repo-tracked seed URLs and reasons
- `configs/sources/official_web/<site_id>/crawl-policy.json`: shared URL/content/frontier policy
- `configs/sources/official_web/<site_id>/scheduler-policy.json`: lane cadence, host scope, and per-run budget policy
- `configs/sources/official_web/<site_id>/credentials.schema.json`: runtime secret shape only
- `configs/sources/official_web/<site_id>/projection-declarations.json`: downstream projection declarations

These files are source-channel truth. They are not collection runtime profiles.
