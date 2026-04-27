# wechat-official-account-core

Source-truth helpers for the `wechat_official_account` source channel.

This package owns:

- FeedWe metadata-to-source-truth projection
- metadata-only article manifest and replay artifact validation
- stable artifact builders for collector runtimes

This package does not own:

- provider HTTP access
- object-store writes
- article body crawling
- notice read-model projection or query serving
