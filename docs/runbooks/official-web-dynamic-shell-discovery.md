---
doc_type: runbook
status: active
created: 2026-04-01
updated: 2026-04-01
---

# Official Web Dynamic Shell Discovery

## 文档边界

这份 runbook 只负责 `official-web-collector` 针对 shell 页的 browser-assisted discovery。

它回答的是：

- 什么情况下允许对 shell 页启用浏览器发现
- 浏览器发现产物怎样回灌到现有静态 source-truth lane
- `lib.muc.edu.cn` 这类 host 该怎样做 host-scoped pilot

它不负责：

- 把 shell 页本身改判为正文页
- 修改 projection replay contract
- 进入 chunk / index / retrieval gate

## 核心规则

- shell 页本身仍然保持 `dynamic_shell_page` / `manual_review`
- browser-assisted discovery 只负责发现可复抓的同源列表页和详情页 URL
- promoted URL 重新进入现有 `crawl.ts` request queue，使用当前 `manual_requeue` 语义
- `manual_requeue` URL 不再继续作为通用 navigation frontier 扩张，避免详情页导航噪声反向污染 crawl frontier
- promoted URL 最终仍由静态 HTML fetch + Cheerio extraction 产出 source-truth

## Host Config

当前 host-scoped policy 放在：

- [hosts.json](/home/reptilian/code/campus-agent/.worktrees/official-web-crawler/configs/sources/official_web/muc_public/hosts.json)

`dynamic_shell_discovery` 字段负责冻结：

- `engine`
- `wait_after_load_ms`
- `network_observation_timeout_ms`
- `max_promoted_urls`
- `allowed_request_url_patterns`
- `ignored_request_url_patterns`
- `promoted_url_patterns`
- `wait_for_response_url_patterns`
- `wait_for_selector_patterns`

`qc-policy.json` 负责冻结 shell-family review allowlist，避免每次运行都用临时 CLI 参数放行已知样本。

## 运行前准备

安装 JS 依赖并确保 Playwright Chromium 可用：

```bash
pnpm install
pnpm --dir apps/official-web-collector exec playwright install chromium
```

## Pilot 执行

先只跑 `lib.muc.edu.cn`：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id smoke-20260401-lib-dynamic-shell-v6 \
  --host lib.muc.edu.cn \
  --max-pages-per-host 12 \
  --max-total-pages 12 \
  --output-dir /tmp/official-web-lib-dynamic-shell-20260401-v6
```

然后执行 validator 和 QC gate：

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-lib-dynamic-shell-20260401-v6 --json

pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-lib-dynamic-shell-20260401-v6 \
  --json
```

## 抽样重点

- 根页 `https://lib.muc.edu.cn/` 是否仍然留在 `dynamic_shell_page`
- `url-results.jsonl` 是否出现 `manual_requeue` 的同源 promoted URL
- `dynamic-shell-discovery-audit.jsonl` 是否记录：
  - response / selector wait 是否命中
  - capture URL 与提取候选 URL
  - resolved URL、admission 结果和最终 promoted URL
- promoted URL 是否主要落在：
  - `/engine2/general-rest/...`
  - `/engine2/d/...`
  - `/db/detail?...`
  - `/engine2/general/m/...`
- promoted 详情页是否在 `source-truth/content-blocks.jsonl` 中出现稳定正文块

## 失败处理

- 如果 Playwright 不可用，collector 会把问题写入 `failures.jsonl`，reason 为 `dynamic_shell_discovery_failed`
- 如果 event-driven wait 始终没有命中，先看 `dynamic-shell-discovery-audit.jsonl`；只有确认前端确实没有出现稳定 response / selector 信号时，才回退扩大 `wait_after_load_ms`
- 如果 promoted URL 因 query allowlist 被拒绝，应先修 host policy，不要在 extractor 里加 host-specific hack
- 如果 promoted URL 进入 crawl 后仍落成 shell family，应继续保留 review，不要直接把 shell 页投成正文页
