---
doc_type: policy
truth_scope: ops
owner_boundary: domains/official-web
status: active
created: 2026-03-28
updated: 2026-05-01
---
# Official Web Crawl Policy

## 文档边界

本文冻结 `official_web` source channel 的 crawl scope、URL
admission、robots/sitemap、frontier、重试与节流 policy。

它回答的是：

- 哪些 host / URL 可以进入 crawl frontier
- canonical URL 应如何规范化
- robots、sitemap、参数 URL、redirect、404/410、304 应如何处理
- per-host 限速、深度、页面上限与失败处理如何定义

它不负责：

- collector 与 ingestion 的系统分层
- web source-truth 的字段级 schema
- 站点特定的 host 清单与 seed URL 内容
- 具体 Crawlee 代码实现

对应文档：

- source channel 边界：`docs/architecture/domains/official-web/architecture.md`
- freshness /
  增量采集：`docs/architecture/domains/official-web/freshness-and-incremental-crawling.md`
- source-truth schema：`docs/data/official-web-source-truth-schema.md`

## 目标

本 policy 的目标是把“可以抓哪些 URL”与“应该怎样抓”固定成可复用、可审计、可 replay 的长期规则，并避免：

- 把第三方外链、登录页、搜索页、参数页误纳入 crawl scope
- 因 sitemap 缺失或导航发散而制造无限 URL 空间
- 因 robots / redirect / canonical / query 参数处理不一致而造成 source-truth 漂移

## 核心结论

- crawl scope 的真相源是 `site config + host allowlist + seed URLs`，不是“所有导航可达链接”。
- `site config + host allowlist + seed URLs` 只定义 source reachability registry，不定义默认
  collection target。默认 collector 执行必须拿到 `app-api` target workset admission；没有该准入时，
  只能通过显式 legacy/debug admission 运行，且该运行不得进入 handoff、selected-write 或 promotion。
- host 是 crawl policy 的一级边界；robots、rate limit、seed URLs、allow/deny 规则都必须按 host
  配置。
- sitemap 只是 discovery signal，不是 scope truth。
- sitemap `lastmod`、RSS/Atom 时间戳等外部更新信号只能作为 discovery / priority input，不是页面变化真相。
- query URL 默认拒绝；只有显式白名单参数才允许进入 canonical identity。
- `official_web` v1 只抓取 `text/html` 公共页面，不默认纳入登录态页面、应用壳、搜索结果页、动作页或非 HTML 下载页。

## Policy 层级

长期配置层级固定为：

- site-level policy
- host-level policy
- seed-level policy
- run-level limits
- consumer-denominator retention policy

前四层回答 URL 能否进入 crawl frontier；consumer-denominator retention policy 回答 fetched
page 是否值得 retained 为 source-truth candidate。二者不得合并：允许 crawl 不等于允许进入
downstream candidate。

执行层还必须额外满足 run admission：`host_filter` 只能缩小已准入的 target workset，不能
单独把 host allowlist 提升为 collection target。

### Site-level policy

site-level policy 负责冻结：

- `site_id`
- 允许的 host 集合
- 共享 URL normalization 规则
- 共享 query 参数 deny/allow 规则
- 共享 user-agent / timeout / retry baseline

### Host-level policy

host-level policy 负责冻结：

- `host`
- `public_kind`
- `enabled`
- `seed_urls`
- `allowed_path_prefixes`
- `denied_path_patterns`
- `query_param_allowlist`
- `max_depth`
- `max_pages_per_run`
- `max_concurrency`
- `min_delay_ms`
- `respect_robots`
- `explicit_sitemaps`

`public_kind` 允许值固定为：

- `content_site`
- `directory_site`
- `portal`
- `app_shell`

首版只允许默认启用：

- `content_site`
- `directory_site`

`portal` 与 `app_shell` 默认禁用，除非后续单独批准。

## Host Admission

### 允许规则

某个 URL 只有在满足以下条件时才能进入 frontier：

- scheme 为 `https`
- target host 在显式 allowlist 中
- target host 当前 `enabled=true`
- path 符合 host-level allow rules
- path 不命中 deny rules
- robots 允许抓取
- URL 通过 query parameter policy

即使命中这些条件，页面仍必须经过 consumer-denominator retention gate，才能进入 retained
source-truth candidate。

### 拒绝规则

以下 URL 默认不得进入 frontier：

- 非 allowlist host
- 第三方域名
- 认证入口、登录、SSO、账户中心、个人门户
- 搜索结果页
- 排序、筛选、分页、会话态参数页
- 表单提交目标页
- 明显的动作页，例如 `apply`、`login`、`logout`、`submit`、`vote`
- 非 HTML 下载页，例如 PDF、ZIP、Office 文档
- API endpoint、feed、XHR endpoint

## URL Discovery

### Discovery 顺序

collector 应按以下顺序发现 URL：

1. repo-tracked seed URLs
1. `robots.txt` 中显式声明的 sitemap URLs
1. host config 中显式声明的 sitemap URLs
1. 页面导航与内容出链扩展

### Sitemap 原则

- sitemap 只作为 discovery signal，不作为 crawl scope truth
- sitemap 中的 URL 仍需经过 host allowlist 与 URL admission 规则
- 一个 sitemap 只能覆盖单 host；不得用一个根 sitemap 替代多个子域 host policy
- 不要求每个 host 必须有 sitemap

### Navigation 扩展原则

对 Crawlee 的使用形态固定为：

- 默认以当前 hostname 内扩展为主
- 跨 host 扩展只能发生在 target host 已被显式 allowlist 时
- 不得因为 `same-domain` 策略而把整个 `*.example.edu` 自动放开

原因：

- repo 的 scope truth 是显式 host allowlist，不是顶级域名通配
- `same-domain` 适合“全部子域都可抓”的场景，不适合作为本仓库长期默认边界

## URL Canonicalization

### 必须保留的四层 URL

每个页面必须保留：

- `requested_url`
- `final_url`
- `declared_canonical_url`
- `normalized_canonical_url`

### 规范化规则

`normalized_canonical_url` 的计算规则固定为：

- 优先使用页面声明的 canonical URL，但必须是绝对 URL、同协议族且通过 allowlist / policy 校验
- 如果页面没有可接受的 canonical URL，则使用 `final_url`
- 如果请求在 redirect 前即失败，则回退到 `requested_url`
- scheme 一律规范化为小写
- host 一律规范化为小写
- 默认端口必须移除
- fragment 一律移除
- path 中的 dot-segments 必须折叠
- query 参数按 key 字典序排序
- tracking 参数必须移除
- 未显式允许的 query 参数必须移除；若 URL 仍依赖被拒参数才能表达页面身份，则该 URL 不应进入 scope

### Tracking 参数

默认移除的 tracking 参数至少包括：

- `utm_*`
- `spm`
- `from`
- `source`
- `sourceid`
- `session`
- `sid`
- `token`

具体站点如有额外参数，必须在 host policy 中显式登记。

## Query URL Policy

### 默认立场

默认拒绝带 query 的 URL。

原因：

- faceted / parameter URLs 极易制造无限 URL 空间
- 参数 URL 常常只是排序、筛选、会话或埋点，不对应稳定内容身份

### 允许例外

仅当以下条件同时满足时，某类 query 参数才可白名单保留：

- 参数直接决定稳定内容资源 identity
- 页面正文在不同参数值下确实代表不同 canonical 内容
- 参数集合有限且可控
- host owner 明确确认该参数不是 session / filter / sort / tracking 参数

## Robots Policy

### 基本规则

- 每个 host 都必须单独读取自己的 `robots.txt`
- `robots.txt` 的作用范围只限于其协议、host、端口
- collector 默认必须尊重 `robots.txt`
- 禁止通过 repo 配置绕过明确的 `Disallow`

### 错误处理

对 `robots.txt` 的处理规则固定为：

- `4xx` 视为 unavailable，可继续 crawl
- `4xx` 时仍可回退到 host config 中显式声明的 sitemap URLs
- `429` 视为限流信号，当前 host 退避并可终止本轮 host crawl
- `5xx`、DNS 失败、网络超时、连接错误视为 server-side failure，当前 host fail-closed
- fail-closed 的 robots 失败必须进入 host failure 记录，不能默默降级为“正常可抓”

这与 RFC 9309 和 Google 当前公开解释一致。

## Content Fetch Policy

### 首版允许的响应类型

`official_web` v1 只接受：

- `200 OK` 或 `304 Not Modified`
- `Content-Type` 为 `text/html` 或可被安全视作 HTML 的响应

以下响应在首版不进入 `official_web` 页面 source-truth：

- PDF
- 图片
- Office 文档
- ZIP / 二进制文件
- JSON API

### Redirect

- `3xx` redirect 必须被记录为 crawl observation
- redirect chain 必须限制最大跳数
- redirect target 仍需通过 host allowlist 与 URL policy
- 长 redirect chain 应计入 warning

### Conditional Fetch

如上次观测存在可用的 `ETag` 或 `Last-Modified`，collector 应优先发起条件请求：

- `If-None-Match`
- `If-Modified-Since`

若返回 `304 Not Modified`：

- 不生成新的 raw/source-truth version
- 仍生成新的 crawl observation
- 复用已知页面的 `response_body_hash` 与 `main_content_hash`
- 更新 `last_seen_at`、`last_not_modified_at` 与下一次抓取资格

## Frontier Policy

### Queue 语义

frontier 必须是显式 request queue，而不是递归函数式遍历。

队列中的 request identity 固定为：

- `normalized_canonical_url` 对应的稳定 unique key

同一 URL 若仅因：

- fragment 不同
- tracking 参数不同
- query 参数顺序不同

不得进入两次。

### 深度与页面上限

每个 host 都必须有：

- `max_depth`
- `max_pages_per_run`

默认原则：

- 深度宁可偏保守，也不允许无限扩展
- 内容发现宁可通过后续 seed 扩充，也不靠单次 run 穷举

## Concurrency And Rate Limits

collector 可以使用 Crawlee 的 autoscaling，但必须在 host policy 上限内运行。

每个 host 至少固定：

- `max_concurrency`
- `min_delay_ms`
- `request_timeout_ms`
- `max_retries`

长期默认原则：

- autoscaling 只能在 policy 上限内调节
- 遇到 `429` 或连续 `5xx` 时必须退避
- 单 host 的失败率超过阈值时应提前中止 host crawl

## Retry Policy

- 网络抖动、瞬时 `5xx`、短暂 timeout 可有限重试
- `404`、`410`、显式 `Disallow`、内容类型不受支持不得重试为成功
- `429` 必须带指数退避
- redirect loop 必须终止并记为 failure
- 已知 canonical URL 在 retryable 失败后，collector 必须上报 `fetch_failed` page
  observation，交给 `app-api` 写入 repair cadence

## 生命周期语义

### 404 / 410

当页面返回 `404` 或 `410` 时：

- collector 必须记录 tombstone-like observation
- collector 不直接删除下游文档真相
- 若该 URL 属于已知页面，observation 应显式标记为 `deleted`
- 是否 tombstone 某个 document，由中心 ingestion 决定

### 页面从导航消失

页面不再从导航中出现时：

- 这只是 discovery signal 变化
- 不等于页面已删除
- 不得因为“本轮未发现”就自动 tombstone

### Redirect 替代

当旧 URL 永久 redirect 到新 URL 时：

- redirect observation 必须落盘
- 新旧 URL 的 canonical identity 关系必须可追溯
- 是否合并到同一 document identity，由中心 ingestion 判定

## 首版 operator posture

首版默认 posture 固定为：

- 只抓公共页面
- 不开启凭证抓取
- 不允许第三方域扩展
- 不抓取应用壳、门户、搜索和动作页
- 不抓取非 HTML 下载资源

## 非目标

- 不在本文决定哪个站点首先上线
- 不在本文决定每个 host 的具体阈值数值
- 不在本文定义 block-level 正文抽取算法
- 不在本文定义下游 collection projection

## 参考

- RFC 9309 Robots Exclusion Protocol: <https://www.rfc-editor.org/rfc/rfc9309>
- Google robots.txt interpretation:
  <<https://developers.google.com/search/docs/c>
  rawling-indexing/robots/robots_txt>
- Google managing faceted navigation URLs:
  <https://developers.google.com/crawling/docs/faceted-navigation>
- Google crawl budget guidance:
  <<https://developers.google.com/search/docs/crawl>
  ing-indexing/large-site-managing-crawl-budget>
- Google canonical URL guidance:
  <<https://developers.google.com/search/docs/craw>
  ling-indexing/consolidate-duplicate-urls>
- Sitemaps protocol: <https://www.sitemaps.org/protocol.html>
- Crawlee adding URLs: <https://crawlee.dev/js/docs/introduction/adding-urls>
- Crawlee enqueueLinks: <https://crawlee.dev/js/api/core/function/enqueueLinks>
- Crawlee RobotsTxtFile:
  <https://crawlee.dev/js/api/3.14/utils/class/RobotsTxtFile>
