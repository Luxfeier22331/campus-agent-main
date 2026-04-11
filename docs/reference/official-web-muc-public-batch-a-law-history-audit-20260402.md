---
doc_type: reference
status: historical
created: 2026-04-02
updated: 2026-04-12
---

# Official Web `muc_public` Batch A Audit 2026-04-02

## 范围

这份记录固化 `muc_public` 第一轮扩面验证 Batch A 在 2026-04-02 的最新 live audit 结果。

当前 repo truth 以同日修正后的 refresh run 为准：

- `crawl_run_id = qc-20260402-batch-a-law-history-r5`
- 这轮 refresh 主要用于收敛 `law.muc.edu.cn/szdw1.htm` 的 dense roster family truth
- 本文不再沿用更早 run 中关于 `law/szdw1.htm` 的过时叙述

本轮只验证：

- `law.muc.edu.cn`
- `history.muc.edu.cn`

它们都已经存在于 repo-tracked：

- `configs/sources/official_web/muc_public/site.json`
- `configs/sources/official_web/muc_public/hosts.json`
- `configs/sources/official_web/muc_public/seeds.json`

本轮不做：

- 新增 host allowlist
- 调整 query-serving / retrieval 范围
- 把 Batch A 直接提升为 hot lane

## 选择依据

2026-04-02 live probe 显示：

- 两个 host 根页都可直接 `200 OK`
- 都是典型公开学院站，而不是动态 shell 站
- 首页存在稳定的站内栏目链接，可直接进入静态 source-truth lane

站点入口：

- <https://law.muc.edu.cn/>
- <https://history.muc.edu.cn/>

## 执行命令

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck

pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id qc-20260402-batch-a-law-history-r5 \
  --host law.muc.edu.cn \
  --host history.muc.edu.cn \
  --max-pages-per-host 10 \
  --max-total-pages 20 \
  --output-dir /tmp/official-web-qc-batch-a-law-history-r5

pnpm --dir apps/official-web-collector validate -- \
  --output-dir /tmp/official-web-qc-batch-a-law-history-r5 \
  --json

pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-batch-a-law-history-r5 \
  --json

uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth \
  --output-dir /tmp/official-web-qc-batch-a-law-history-r5 \
  --projection-output-dir /tmp/official-web-qc-batch-a-law-history-r5-projection

uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir /tmp/official-web-qc-batch-a-law-history-r5-projection
```

## 结果摘要

### Crawl

- `crawl_run_id = qc-20260402-batch-a-law-history-r5`
- `urlsObserved = 20`
- `urlsFetched = 20`
- `failures = 0`
- `hostsCompleted = 2`

host summary：

- `history.muc.edu.cn`: `pagesObserved = 10`, `admissionRejected = 23`, `failures = 0`
- `law.muc.edu.cn`: `pagesObserved = 10`, `admissionRejected = 39`, `failures = 0`

### Source-Truth Validator

- `valid = true`
- `bundlePages = 20`
- `errors = 0`
- `warnings = 0`

### QC Report

- `valid = true`
- `passPages = 20`
- `reviewPages = 0`
- `failPages = 0`

family counts：

- `article_detail = 7`
- `listing_page = 7`
- `directory_page = 6`
- `dynamic_shell_page = 0`
- `structural_shell_page = 0`
- `generic_content_page = 0`

按 host 分布：

- `history.muc.edu.cn`: `listing_page = 4`, `article_detail = 6`
- `law.muc.edu.cn`: `listing_page = 3`, `directory_page = 6`, `article_detail = 1`

### Projection Replay

- `pages_seen = 20`
- `emitted_documents = 20`
- `manual_review_pages = 0`

projection validator：

- `valid = true`
- `documents = 20`
- `errors = 0`
- `warnings = 0`

## 抽样结论

### `law.muc.edu.cn`

- `https://law.muc.edu.cn/xygk/xyjj.htm` 被稳定识别为 `article_detail`
- source-truth 主内容块保留了完整学院简介正文
- projection `canonical.md` 能输出连续正文段落，不是空文档

- `https://law.muc.edu.cn/szdw1.htm` 被识别为 `directory_page`
- `pageFamilyReason = dense_short_link_directory_signal`
- source-truth 主内容块直接保留了大量教师姓名链接，而不是日期型资讯条目
- projection `canonical.md` 直接落出教师姓名清单，不是 shell/review，也不是误投成 generic listing

- `https://law.muc.edu.cn/szdw1/zrjs.htm`、`https://law.muc.edu.cn/szdw1/rxjs.htm`
  也被稳定识别为 `directory_page`
- 说明法学院这组 roster family 现在已经从薄目录页扩展到 dense direct roster 页的一致真相

### `history.muc.edu.cn`

- `https://history.muc.edu.cn/xygk/lxfs.htm` 被稳定识别为 `article_detail`
- source-truth 主内容块保留了地址、邮编、电话、邮箱等联系方式
- projection 文档可以直接消费这些联系信息

- `https://history.muc.edu.cn/` 被识别为 `listing_page`
- `pageFamilyReason = mixed_card_date_link_listing_signal`
- 首页资讯与研究栏目进入 projection，没有出现 shell/manual_review

## r5 发现的质量问题

本轮没有 correctness error，但有一类值得继续修的质量噪声：

- `history.muc.edu.cn` 首页 listing projection 存在列表项与子链接重复保留的现象
- 某些日期前缀被拼成 `242026.03`、`122026.03` 这类噪声 token
- 这更像 `listing_page` 聚合卡片去重/归一化问题，不是 host admission 或 shell 问题

这类问题当时不阻塞 Batch A 进入 baseline source-truth/replay，但也不应据此直接提升到高频 hot lane。

## 2026-04-02 r6 follow-up 验证

为关闭上述 `history` listing projection 质量噪声，当前 worktree 在同日补跑了单 host `r6` 跟进验证：

```bash
pnpm --dir apps/official-web-collector crawl -- \
  --site-id muc_public \
  --crawl-run-id qc-20260402-history-r6 \
  --host history.muc.edu.cn \
  --max-pages-per-host 10 \
  --max-total-pages 10 \
  --output-dir /tmp/official-web-qc-history-r6

pnpm --dir apps/official-web-collector validate -- \
  --output-dir /tmp/official-web-qc-history-r6 \
  --json

pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-history-r6 \
  --json

uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth \
  --output-dir /tmp/official-web-qc-history-r6 \
  --projection-output-dir /tmp/official-web-qc-history-r6-projection

uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir /tmp/official-web-qc-history-r6-projection
```

结果：

- collector `validate`: `valid=true`, `errors=0`, `warnings=0`
- `qc-report`: `passPages=10`, `reviewPages=0`, `failPages=0`
- projection replay: `pages_seen=10`, `emitted_documents=10`, `manual_review_pages=0`
- projection validator: `valid=true`, `errors=0`, `warnings=0`

基于同一 `qc-20260402-history-r6` artifact，当前 worktree 又补跑了一次 projection replay + validator，确认第二轮 listing cleanup 之后输出仍然保持：

- projection replay: `pages_seen=10`, `emitted_documents=10`, `manual_review_pages=0`
- projection validator: `valid=true`, `errors=0`, `warnings=0`

抽样复核：

- `https://history.muc.edu.cn/` 的 `canonical.md` 已不再保留 `NEWS&NOTICS` / `RESEARCH` badge 行
- 首页重复保留的资讯标题与日期对已经收敛为单条 listing entry
- `https://history.muc.edu.cn/xwz2025/sy.htm` 这类 mixed-card listing 也不再保留同一 section 内迟到的 `标题 + 日期` 重复行
- `快速链接` 不再同时保留聚合 list-item 行和其下逐条子链接
- `https://history.muc.edu.cn/rcpy.htm` 不再出现 `122026.03`、`2026-03-122025...` 这类压缩日期前缀，当前会归一化为 `2026-03-12 2025-2026-1学期缓补考时间安排` 这类可读形式
- `https://history.muc.edu.cn/rcpy/bkjx.htm` 不再保留 `2`、`3`、`下页`、`尾页` 这类分页控件
- `https://history.muc.edu.cn/` 与 `https://history.muc.edu.cn/xwz2025/sy.htm` 不再保留 `信息门户`、`领导信箱`、`精品课程`、`图书馆` 一类工具入口
- 首页与 `xwz2025/sy.htm` 的 `科学研究` / `资讯公告` 卡片长摘要段落已从 listing projection 中剔除，避免把详情页摘要误投成导航条目

结论：

- `history` listing projection 的重复项 / 日期噪声已在当前 worktree 关闭
- 本轮追加关闭了分页控件、工具入口、长摘要段落、section badge 标题这 4 类第二层 listing 噪音
- 这次关闭的是 projection 质量问题，不改变 host allowlist、scheduler cadence 或 query-serving scope

仍存的低优先级残留：

- `https://history.muc.edu.cn/rcpy/bkjx.htm` 仍保留 `本科教学`、`研究生教学`、`招生就业` 这组页内导航入口
- 同页仍有一条 `立项年份计划编号项目类型中文题名依托单位...` 式表格聚合行，当前更像 table-ish 聚合噪音，不是 correctness blocker

## 结论与处置

- `law.muc.edu.cn` 与 `history.muc.edu.cn` 已经证明可进入当前 `muc_public` baseline source-truth 批次
- 现有 projection declarations 足以覆盖本轮出现的 page family
- 当前不需要新增 host config；两个 host 已在 repo-tracked enabled scope 内
- 当前不建议直接加入 `scheduler-policy.json` 的 `hot` lane
- `law/szdw1.htm` 的当前 merged-in-worktree truth 已明确为 `directory_page`，不再按 generic `listing_page` 叙述

暂不加入 hot lane 的原因：

- 这两个学院站的更新频率和业务优先级尚未证明需要 30 分钟级刷新
- 即使当前 `history` listing projection 噪声已经关闭，scheduler / hot lane 仍然需要单独的 freshness / priority 证据

## 下一批建议

如果继续扩面，优先从同类公开学院站里选 1 到 2 个 host：

- `art.muc.edu.cn`
- `cie.muc.edu.cn`
- `edu.muc.edu.cn`

执行策略保持不变：

1. 低预算 crawl
2. validator
3. qc-report
4. projection replay + validator
5. 人工抽样后再决定是否提高预算或调整 lane
