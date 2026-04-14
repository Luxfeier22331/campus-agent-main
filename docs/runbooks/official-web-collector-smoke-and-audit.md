---
doc_type: runbook
status: active
created: 2026-03-29
updated: 2026-04-02
---

# Official Web Collector Smoke And Audit

## 文档边界

这份 runbook 只负责 `official-web-collector` 的 regression、真实站点 smoke、输出审计，以及与 `app-api` control plane 契约相关的回归入口。

它回答的是：

- 怎样先验证 collector / app-api / panel 的 contract 没有回退
- 怎样区分 stable regression gate、low-budget expansion batch 和 scheduler / hot lane promotion
- 怎样对 `muc_public` 的代表性 host 做一轮小规模 smoke
- 怎样用本地 validator 审计一次 crawl output
- 怎样复验 `304/not_modified`、`fetch_failed`、listing-detail requeue 这些增量路径
- smoke 发现问题后怎样把问题沉到 fixture / test / extractor

它不重复：

- source channel 边界：`docs/architecture/official-web-architecture.md`
- crawl policy：`docs/policies/official-web-crawl-policy.md`
- freshness / 增量采集：`docs/architecture/official-web-freshness-and-incremental-crawling.md`
- source-truth contract：`docs/architecture/official-web-source-truth-contract.md`
- control-plane / app-api 契约：`docs/contracts/app-api-official-web-http.md`

## 0. 双轨执行面

当前 repo 对 `official_web` 固定采用两条执行面，外加一条单独的 scheduler 判断：

- stable regression gate
  固定 5-host 回归面，用于 extractor、QC 规则、projection replay 的稳定性回归
- low-budget expansion batch
  面向已 allowlisted 但不在 stable gate 里的 host；先用低预算 batch 验证 source-truth 和 replay，不直接扩大范围
- scheduler / hot lane promotion
  单独的 control-plane / freshness 决策；不由 stable gate 或 expansion batch 自动推出

三者必须明确区分：

- host 已写进 `hosts.json` / `seeds.json`
  不等于已经通过 stable regression gate
- host 已完成一次 expansion batch
  不等于已经进入 `scheduler-policy.json`
- host 已通过 source-truth QC + projection replay
  也不等于可以直接进入 `hot lane`

## 前置条件

执行前确认：

- `apps/official-web-collector`、`apps/app-api`、`apps/protected-panel-web` 依赖已经安装
- repo 中 `configs/sources/official_web/muc_public/` 为当前真相源
- 当前输出目录使用本地临时路径，例如 `/tmp/official-web-smoke-<host>-<date>`

如果要做真实 control-plane smoke，而不是 artifact-only smoke，额外确认：

- `apps/app-api/.dev.vars` 已填入 `BETTER_AUTH_SECRET`、`PUBLIC_CHAT_WEB_ORIGIN`、`SUPERVISOR_API_*`、`APP_API_OPERATOR_EMAIL_ALLOWLIST`、`APP_API_INTERNAL_SHARED_SECRET`
- `apps/app-api/.dev.vars` `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` 非空
- `apps/app-api/.env` 已提供
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  与 `APP_API_MANAGEMENT_DATABASE_URL`
- 如果 root worktree `.env` 已配置共享 Supabase Postgres，可先运行
  `uv run --all-packages python -m scripts.sync_app_api_local_db_env --repo-root <current-worktree-root>`
- `apps/official-web-collector/.env` 已提供
  `OFFICIAL_WEB_APP_API_BASE_URL` 与 `OFFICIAL_WEB_SERVICE_TOKEN`
- `OFFICIAL_WEB_SERVICE_TOKEN` 与 `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` 一致
- 本地 `app-api` 的 `official_web` schema 与当前代码一致；如果 worktree 刚同步过 schema 变更，先运行
  `pnpm --dir apps/app-api db:migrate`
- 如果当前在 feature worktree，可先运行
  `uv run --all-packages python -m scripts.link_worktree_app_local_env --repo-root <current-worktree-root>`
  复用 root worktree 的 app-local env

说明：

- 如果当前目标只是 `artifact-only smoke`，或 staging 当前并未部署 official-web collector，这组 token 不是必需项
- `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` / `OFFICIAL_WEB_SERVICE_TOKEN` 只保护 `official-web-collector -> app-api` 这条 live control-plane seam，不参与当前最小 chat/panel/app-api staging 闭环

## 1. 包级回归

先跑 collector 单包回归：

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
```

当前 checked-in fixtures 位于：

- `apps/official-web-collector/test/fixtures/pages/sample-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-home-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-directory-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-news-home-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-news-article-detail.html`
- `apps/official-web-collector/test/fixtures/pages/sample-dt-list-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-feature-list-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-contact-card-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-dynamic-shell-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-xiaoyou-home-page.html`
- `apps/official-web-collector/test/fixtures/pages/sample-xiaoyou-list-page.html`

规则：

- smoke 发现的新模板问题，优先先补 fixture 和 regression test，再改 extractor
- 不要把 `/tmp` 里的临时样本当长期测试真相
- 上述 fixtures 同时承担小规模 golden audit set 的职责；page-family 或 quality-signal 回归必须先在这里固定

## 2. Control-Plane 契约回归与门禁

在进入真实站点 smoke 前，先完成这组回归门禁，确认 `app-api` planner/query/repair 契约没有回退：

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api typecheck
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:shared-db-integration
pnpm --dir apps/protected-panel-web typecheck
pnpm --dir apps/protected-panel-web test
```

这一步至少覆盖：

- collector start / heartbeat / `plans:resolve` / finalize HTTP seam
- `page_observations` 到 `page_freshness` 的推进
- `fetch_failed -> repair` 的控制面语义
- panel `Run Detail` / `Site Detail` 的 query contract

说明：

- 当前 CLI smoke 主要覆盖 artifact/source-truth 产出
- planner/control-plane 路径优先由单元测试和集成测试收口，而不是在 CLI 里手工伪造数据库状态

如果要做 live seam 复验，可先启动本地 `app-api`：

```bash
pnpm --dir apps/app-api dev
```

`wrangler dev` 会打印实际监听端口。下面示例使用 `http://127.0.0.1:8790`，但应以终端实际输出为准。

然后再让 collector 指向本地 control-plane，并至少跑一轮单 host smoke + validator：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id smoke-20260330-control-plane \
  --host www.muc.edu.cn \
  --max-pages-per-host 1 \
  --max-total-pages 1 \
  --output-dir /tmp/official-web-control-plane \
  --app-api-base-url http://127.0.0.1:8790 \
  --service-token "$OFFICIAL_WEB_SERVICE_TOKEN"

pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-control-plane --json
```

如果这轮 live seam 需要同时确认 operator query surface，可在 collector finalize 后手动 drain 一次
`app-api` `official_web` projection：

```bash
pnpm --dir apps/app-api official-web:drain-projection -- --limit 50
```

说明：

- 这个命令读取 `apps/app-api/.env` 与 `apps/app-api/.dev.vars`，直接把 `official_web.run_outbox` materialize 到 operator `site/run` projections
- 如果本地没有配置 `APP_API_OFFICIAL_WEB_HANDOFF_URL` 与 `APP_API_OFFICIAL_WEB_HANDOFF_TOKEN`，命令输出里的 `handoffConfigured` 会是 `false`
- 在这种本地模式下，terminal run 仍会投影到 operator query surface，但 `ingestionDispatchStatus` 会保持 `queued`，且 drain 结果里会出现 handoff 失败计数；这不影响验证 panel/operator 是否已经能看到 run/site detail
- 完成 drain 后，再调用 `/api/operator/official-web/runs`、`/api/operator/official-web/runs/:runId`、`/api/operator/official-web/sites/:siteId` 验证 projection 是否已经可见

如果这轮本地联调还要同时验证 `app-api -> ingestion-worker` handoff seam，可先启动本地 receiver：

```bash
set -a
source env/commands/official-web-handoff-receiver.env.example
set +a
uv run --all-packages campus-ingestion-official-web-handoff-dev
```

然后在另一终端临时覆盖 `app-api` handoff env 再 drain：

```bash
APP_API_OFFICIAL_WEB_HANDOFF_URL=http://127.0.0.1:8789/api/official-web/handoffs \
APP_API_OFFICIAL_WEB_HANDOFF_TOKEN=replace-with-local-official-web-handoff-secret \
pnpm --dir apps/app-api official-web:drain-projection -- --limit 50
```

如果这轮还要继续验证 ingestion-worker 是否真的把 handoff replay 成 projection output，可在 drain 完成后执行 consumer：

```bash
set -a
source env/commands/official-web-handoff-consumer.env.example
set +a
uv run --all-packages campus-ingestion-consume-official-web-handoffs --limit 20
```

通过标准：

- `drain-projection` 返回 `handoffConfigured=true`
- `official_web.run_outbox` 不再残留 `last_error`
- operator `official_web_run_projection.ingestion_dispatch_status` 变为 `dispatched`
- 本地 inbox 目录按 `eventId` 落下 handoff record
- consumer 默认输出 `staged > 0`
- inbox record 默认 `processingStatus = staged`
- `execution-report.json.validation.valid = true`
- `execution-report.json.chunkAudit.passed = true`
- `execution-report.json.bundleObjectKey` 指向 `official_web/<site_id>/runs/<run_id>/source-truth-bundle.json`

如需把这批数据真正写入 registry current truth，应显式执行：

```bash
uv run --all-packages campus-ingestion-consume-official-web-handoffs --limit 20 --promote
```

此时通过标准改为：

- consumer 输出 `promoted > 0`
- inbox record `processingStatus = promoted`
- `execution-report.json.promotion.decision = promoted`

补充说明：

- 当前 collector 在保留本地 `outputDir` 的同时，也会在 `OBJECT_STORE_*` 已配置时把 run artifacts 与 per-page source-truth 上传到 source bucket
- 如果 `artifacts` 仍是空数组，或 source bucket 上缺 `source-truth-bundle.json`，应先修 collector artifact upload，再看 handoff consumer

## 3. 代表性 Host Smoke

建议至少覆盖以下模板：

- `www.muc.edu.cn`
- `news.muc.edu.cn`
- `xxgk.muc.edu.cn`
- `lib.muc.edu.cn`

单 host 小规模 smoke 示例：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id smoke-20260329-news \
  --host news.muc.edu.cn \
  --max-pages-per-host 5 \
  --max-total-pages 5 \
  --output-dir /tmp/official-web-smoke-news-20260329
```

建议的观测点：

- `source-truth-bundle.json`
- `quality-audit.json`
- `page-observations.jsonl`
- `url-results.jsonl`
- `dynamic-shell-discovery-audit.jsonl`
- `source-assets/<raw_asset_id>/<raw_version_id>/source-truth/page-manifest.json`
- `source-assets/<raw_asset_id>/<raw_version_id>/source-truth/content-blocks.jsonl`
- `source-assets/<raw_asset_id>/<raw_version_id>/provider/cheerio-basic/page-extraction.json`

说明：

- `lib.muc.edu.cn` 当前仍是 shell-family 代表样本；根页如果静态返回只含容器和前端 `load()/XHR` 脚本，shell 页本身继续允许 `mainContentBlockCount=0`
- 对配置了 `dynamic_shell_discovery` 的 host，collector 会先保留 shell 页 `manual_review`，再用 browser-assisted discovery 提升同源详情/列表 URL，随后仍由静态 source-truth lane 落地正文页
- `muc_public` 当前通过 repo-tracked `qc-policy.json` 放行已知 shell-family review；`qc-report` 默认不再要求手工 `--allow-review-*`
- 对已知页面做重复 smoke 时，应重点观察第二轮是否出现 `304/not_modified`，以及失败页是否进入 `fetch_failed`

## 4. 本地审计

每次 smoke 后都跑 validator：

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-smoke-news-20260329
```

如需机器可读输出：

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-smoke-news-20260329 --json
```

validator 当前检查：

- run artifacts 是否齐全
- `source-truth-bundle.json` 是否可解析
- `quality-audit.json` 是否可解析
- bundle 中每个 page 的本地文件是否存在
- bundle object key 是否符合 canonical 推导
- response body hash 是否与 `capture/response.html` 和 page manifest 对齐
- `content-blocks.jsonl` 的计数与 raw identity 是否一致
- provider extraction 的 raw identity 是否一致
- page family 是否在 bundle / page manifest / provider extraction / quality audit 之间保持一致
- quality findings 是否被拆分成：
  - correctness errors
  - quality warnings / quality fails

`quality-audit.json` 的第一版重点字段：

- `summary.totalPages / passPages / reviewPages / failPages`
- `summary.familyCounts`
- `summary.issueCounts`
- `pages[].pageFamily`
- `pages[].signals`
- `pages[].status`
- `pages[].issues`

## 4.1 稳定回归 QC Gate

如果当前目标是维护一条稳定 regression gate，先固定这条 5-host 执行面：

- `www.muc.edu.cn`
- `news.muc.edu.cn`
- `xxgk.muc.edu.cn`
- `xiaoyou.muc.edu.cn`
- `lib.muc.edu.cn`

推荐批次参数：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id qc-<date>-batch-a \
  --host www.muc.edu.cn \
  --host news.muc.edu.cn \
  --host xxgk.muc.edu.cn \
  --host xiaoyou.muc.edu.cn \
  --host lib.muc.edu.cn \
  --max-pages-per-host 20 \
  --max-total-pages 100 \
  --output-dir /tmp/official-web-qc-batch-a
```

先跑 validator：

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-qc-batch-a --json
```

再跑 QC gate 汇总：

```bash
pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-batch-a \
  --json
```

当前 gate 的通过标准固定为：

- validator correctness errors = `0`
- `quality-audit.summary.failPages = 0`
- `review` 只允许来自 shell 家族，且 issue code 为 `shell_family_requires_manual_review`

这条 gate 只验证 source-truth 抽取质量，不验证 document/chunk、retrieval 或 answer quality。

如果这条 stable regression gate 已稳定通过，下一步不要直接跳到 retrieval 验收；先进入
[`official-web-source-truth-projection-replay.md`](./official-web-source-truth-projection-replay.md)
定义的 projection replay，并在同一批次上继续跑 projection `validator`。

补充说明：

- 这 5-host gate 是稳定回归批次，不代表 `muc_public` 当前唯一启用的 host 范围
- 已在 `hosts.json` / `seeds.json` 中启用的新增 host，应先走低预算扩面验证 batch，再决定是否提升预算或进入更高频 lane
- 2026-04-02 已完成一轮 `law.muc.edu.cn` + `history.muc.edu.cn` Batch A 验证，记录见
  [official-web-muc-public-batch-a-law-history-audit-20260402.md](/home/reptilian/code/campus-agent/.worktrees/official-web-crawler/docs/reference/official-web-muc-public-batch-a-law-history-audit-20260402.md)

## 4.2 低预算 Expansion Batch

如果当前目标是验证 stable gate 之外的已 allowlisted host，默认走 low-budget expansion batch，而不是直接扩到大批量多 host：

- 每次只选 1 到 2 个 host
- 默认只选已经存在于 `hosts.json` / `seeds.json` 的 host
- 默认预算先保持在 `--max-pages-per-host 10`、`--max-total-pages 20`
- 默认必须跑完 `validator -> qc-report -> projection replay -> projection validator`
- 默认必须留下一份 repo-tracked 参考记录

推荐参数：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id qc-<date>-batch-a-<slug> \
  --host <host-a> \
  --host <host-b> \
  --max-pages-per-host 10 \
  --max-total-pages 20 \
  --output-dir /tmp/official-web-qc-batch-a-<slug>

pnpm --dir apps/official-web-collector validate -- \
  --output-dir /tmp/official-web-qc-batch-a-<slug> \
  --json

pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-batch-a-<slug> \
  --json

uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth \
  --output-dir /tmp/official-web-qc-batch-a-<slug> \
  --projection-output-dir /tmp/official-web-qc-batch-a-<slug>-projection

uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir /tmp/official-web-qc-batch-a-<slug>-projection
```

batch closeout 规则：

- reference doc 必须写清楚 host、budget、family counts 和抽样结论
- 未经过 projection replay + projection validator 的 batch，不得写成 validated expansion result
- 通过一次 expansion batch，不得直接修改 `scheduler-policy.json`
- 如需继续验证 app-api -> ingestion import / handoff，再回到本 runbook 第 2 节执行 `drain-projection` 和本地 handoff consumer；否则 expansion batch 默认到 projection validator 为止

## 4.3 问题分流

本轮如果发现问题，只允许落入以下三类，不要混写：

- `extractor_defect`
  - source-truth 结构、块级分类、family 判定或质量审计规则本身出错
- `upstream_page_defect`
  - live HTML 本身就缺字、截断、嵌脏文本或结构错误；collector 只忠实吸收了它
- `static_shell_limitation`
  - 页面正文依赖浏览器执行 `load()/XHR/fetch`，静态 HTML 只有壳或占位容器

`lib.muc.edu.cn` 这类页面默认按 `static_shell_limitation` 处理，不要为了让它在静态抓取下通过而在 extractor 里加入 host-specific hack。

判断“缺字 / 截断”时只允许依赖结构证据，不做语义猜词：

- 可接受证据：
  - 同一 anchor 的 `title` 明显比可见文本更完整
  - 可见文本带有明显省略号或严格前缀式截断
  - 父 `li` 和子 `a` 被重复抽取，且子项只是父项的更短版本
- 不可接受证据：
  - 仅因为人名、短语或前导字符看起来“不自然”就推断缺字
  - 例如 `们发延校友荣获2025年度“全国政协委员优秀履职奖”` 这类 case，如果 live HTML 或同一 anchor 的 `title` 本身就是这样，按 upstream/source-truth 保留，不得人工补首字

额外的增量观测点：

- `url-results.jsonl` 中是否出现 `not_modified`、`deleted`
- `page-observations.jsonl` 中是否出现 `disposition=not_modified / fetch_failed`
- 第二轮重复 smoke 时，页面预算是否明显偏向热点 listing / recent detail

## 5. 人工抽样重点

当前最值得看的不是“有没有产出文件”，而是 source-truth 和增量语义是否正确：

- 默认首页与 `/index.htm` 是否折叠到同一 canonical URL
- 目录/服务页的 `li` 是否仍被误判为 main content
- 聚合卡片父 `li` 是否被抑制，只保留真实 heading / paragraph / link blocks
- 正文或内容列表里的重要链接是否产生 `blockRole=link` 且 `isMainContent=true`
- `title` 属性恢复是否只用于同一 anchor 的更完整文本，而不是据此猜测“应当存在的前缀字”
- `parentHeadingPath` 是否出现 `null` 洞或正文 heading 漂移到 footer/nav
- 重复栏目名、重复导航项是否标成 `isRepeatedCandidate=true`
- 对“疑似截断”页面，是否先核对 `title` 对照、ellipsis、`li + child a` 重复，再决定记为 `extractor_defect` 或 `upstream_page_defect`
- dynamic-shell 页面里的隐藏占位文本是否被抑制，避免把静态壳页误判成有正文
- `pageFamily` 是否稳定落在合理类别：
  - `article_detail`
  - `listing_page`
  - `directory_page`
  - `sitemap_navigation_page`
  - `data_table_page`
  - `gallery_page`
  - `contact_widget_page`
  - `structural_shell_page`
  - `dynamic_shell_page`
  - `generic_content_page`
- `structural_shell_page` 是否只覆盖“静态结构壳页”：
  - 例如空列表页、图像为主且缺少可提取正文的内容页、仅剩标题/面包屑/侧栏的 section shell
  - 不应把实际存在长文本正文但被抽取器漏掉的页面吞掉
- `quality-audit.json` 的 `review/fail` 是否集中在真实问题页，而不是大面积误报
- 对重复抓取的已知页面，`304` 是否正确避免重产 raw/source-truth
- 对 `429` / `5xx` / request failure，是否留下 `fetch_failed` observation，而不是只在 failures artifact 中出现
- 列表页变化后，是否优先 requeue 同 host 的 detail URLs
- robots `4xx`、`429`、`5xx` 三类路径是否符合当前 policy：`4xx` 继续、`429/5xx` fail-closed

## 6. 问题闭环

如果 smoke 发现问题，按这个顺序处理：

1. 记录具体页面和输出文件路径
2. 从真实页面提炼最小 HTML 片段，加入 `test/fixtures/pages/`
3. 先写失败测试
4. 再修改 `apps/official-web-collector/src/page-artifacts.ts`
5. 重新跑 `pnpm --dir apps/official-web-collector test`、`pnpm --dir apps/official-web-collector typecheck`
6. 必要时重跑对应 host smoke

禁止事项：

- 不要只在 `/tmp` 手工检查后就认为问题已解决
- 不要为了通过某个页面临时加 host-specific hack
- 不要把 chunk / document / retrieval 语义塞回 collector source-truth 抽取层

## 7. 扩面推进顺序

默认推进顺序固定为：

1. 修改 extractor / QC 规则后，先回归 stable regression gate
2. 如需验证 stable gate 外的新 host，只开 low-budget expansion batch
3. expansion batch 通过后，先补 repo reference doc，不改 `scheduler-policy.json`
4. 只有在多个 expansion batch 已稳定、且 freshness / priority 有额外证据时，才允许单独讨论 scheduler / hot lane

这一步故意不提供“默认 10-host 扩量命令”。如果需要更大范围 rehearsal，必须先明确说明它不是 stable gate，也不是默认 expansion batch。

## 7.1 重复审计节奏

如果当前重点是“先把既有范围打磨稳”，重复节奏固定为：

1. 每次修改 extractor 或质量审计规则后，先跑 `pnpm --dir apps/official-web-collector test`
2. 再跑稳定 5-host QC batch
3. 再跑 `qc-report` gate
4. 再跑 projection replay + projection validator
5. 人工抽查至少一页 `listing_page`、一页 `article_detail`、一页 `directory_page`、一页 shell 页面
6. 连续两轮都稳定后，才允许继续新的 low-budget expansion batch；这仍不自动推出 `hot lane`

## 8. 更新检测复验

当需要显式验证增量检测路径时，建议用同一 host 连续运行两轮低预算 smoke：

1. 第一轮建立基线 artifact
2. 间隔短时间再次运行相同 host smoke
3. 检查以下结果：
   - `url-results.jsonl` 中是否出现 `not_modified`
   - 已知失败页是否被记为 `fetch_failed`
   - 列表页如果发生变化，是否在本轮 run 内出现 detail requeue

如果需要一条更小、更稳的增量实证，而不是再跑整批 host，优先使用 repo 内最小 live proof：

```bash
pnpm --dir apps/official-web-collector exec tsx scripts/incremental-live-proof.ts
```

这条脚本会：

- 在当前 `muc_public` 既有范围内预探测代表性 host
- 先用真实条件请求筛出此刻能返回 `304` 的页面
- 再让 collector 带 `knownPage` 和条件请求头重放一次
- 在 `/tmp/official-web-incremental-proof-20260401/` 产出 `incremental-proof-report.json`

本次验证至少要看：

- `incremental-proof-report.json.selectedAttempt.collectorResult.outcome = "not_modified"`
- `incremental-proof-report.json.urlResults[0].httpStatus = 304`
- `incremental-proof-report.json.pageObservations[0].disposition = "not_modified"`

说明：

- 这条 proof 只验证 collector 的增量抓取链路，不验证 control-plane due-page 选择
- 某些 host 可能对 `ETag` 或 `Last-Modified` 的行为不稳定，脚本会自动跳过当下不能稳定复现 `304` 的候选
- `304` 响应可能不带 `Content-Type` 或不带可解析正文；这在 collector 中应仍然记为 `not_modified`

如果要验证 control-plane 侧的 `repair`/`hot` workset 选择，优先看 `apps/app-api` 与 `apps/official-web-collector` 的测试用例，而不是在 CLI smoke 中手工模拟数据库状态。

如果第二轮重复 smoke 仍然没有出现 `not_modified`，必须在执行记录里明确写明“本次 smoke 尚未证明增量语义”，不要把 live smoke 误记为已完成这项验证。
