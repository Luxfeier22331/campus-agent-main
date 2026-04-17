# official-web-core

Stable config-loading and planning helpers for the `official_web` source channel.

This package owns:

- repo-tracked `official_web` site config loading
- cross-file validation for hosts, seeds, crawl policy, and credentials posture
- derived crawl-plan construction for collector runtimes
- URL normalization and admission rules shared by collector runtimes
- stable crawl observation / artifact record builders

This package does not own:

- network crawling runtime
- object-store writes
- source-truth generation
- document/chunk/index downstream behavior
