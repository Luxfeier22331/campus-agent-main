---
doc_type: reference
status: completed
created: 2026-03-28
updated: 2026-04-12
---

# Official Web MUC Public Host Survey Snapshot (Historical)

## 文档边界

本文只保留 `2026-03-28` 首版 `muc_public` host survey 的历史快照。

本文回答的是：

- 首版 host allowlist 当时是怎么划出来的
- 哪些 host 当时被明确排除
- 这份 survey 对后续配置收口的历史意义是什么

本文不负责：

- 充当当前 crawl policy
- 充当当前 host enablement truth
- 替代 `official-web` 的架构或 policy 文档

当前应优先阅读：

- `docs/architecture/official-web-architecture.md`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/policies/official-web-crawl-policy.md`

## Historical Snapshot

当时的调查方法固定为：

- 读取 `https://www.muc.edu.cn/` 首页公开导航与快捷入口
- 抽取首页出链中的 `muc.edu.cn` 相关 host
- 点检代表性 host 的首页形态
- 对敏感 host 额外查看 `robots.txt`

当时的关键观察固定为：

- 官网首页暴露了 `44` 个不同 host
- 其中 `muc.edu.cn` 相关 host 为 `34`
- 首页没有提供“可以直接放开整个 `*.muc.edu.cn`”的证据
- 因此首版正确策略是显式 host allowlist，而不是通配 host crawl

## First-Generation Host Classification

当时建议纳入首版 allowlist 的类型只有两类：

- `directory_site`
  - `www.muc.edu.cn`
  - `xxgk.muc.edu.cn`
  - `lib.muc.edu.cn`
- `content_site`
  - `news.muc.edu.cn`
  - `xiaoyou.muc.edu.cn`
  - 以及一批公开学院 / 专题子站，例如 `law.muc.edu.cn`、`history.muc.edu.cn`、`art.muc.edu.cn`

这些 host 的共同历史特征是：

- 能从官网首页公开出链触达
- 首页呈现为公开新闻、栏目、学院或专题内容
- 当时没有发现明确的 `Disallow: /`

## Explicit Historical Exclusions

当时明确排除的两类站点：

- `portal`
  - `my.muc.edu.cn`
  - 原因：官网首页将其标注为“信息门户”，且当时出链仍为 `http`
- `app_shell`
  - `service.muc.edu.cn`
  - 原因：`robots.txt` 明确 `Disallow: /`

同时，首页出链到的第三方域名一律不进入 `muc_public` 首版 allowlist。

## Historical Significance

这份 survey 的历史意义是：

- 首次把 `official_web` 的 host admission 从“看起来像官网”收口成显式 allowlist
- 首次明确区分公开内容站、目录站、portal 和 app shell
- 为后续 `configs/sources/official_web/muc_public/` 的首版配置提供了起点

今天它只保留追溯价值；当前 repo 的 host truth 已经由后续 config、policy 和 source-truth contract 接管。
