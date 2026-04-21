# `campus_notices/file_release_capture`

该 scope 只承载 `authenticated_notice_portal/file_release` 的 PG capture ledger 与 raw-asset truth。

固定边界：

- 当前只 materialize 到本地 PG
- 不是 `notice` source-truth
- 不进入 document/chunk/index/release
- 只服务 owner-recovery/readiness 与 operator 排障
- 当前这条 ledger gap 已关闭，不保留独立 recurring backfill lane
