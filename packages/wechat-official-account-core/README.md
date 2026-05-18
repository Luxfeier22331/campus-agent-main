# wechat-official-account-core

Source-truth helpers for the `wechat_official_account` source channel.

This package owns:

- captured WeChat article page to source-truth projection
- metadata-only terminal validation for verification walls and fetch failures
- media-ref source-truth rows with captured object metadata
- stable artifact builders for collector runtimes

This package does not own:

- provider HTTP access
- object-store writes
- article page or media fetching
- notice read-model projection or query serving
