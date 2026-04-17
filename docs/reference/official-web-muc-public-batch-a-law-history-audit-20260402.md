---
doc_type: reference
status: completed
created: 2026-04-02
updated: 2026-04-12
---

# Official Web `muc_public` Batch A Snapshot (Historical)

## 文档边界

本文只保留 `2026-04-02` `muc_public` 第一轮扩面验证 Batch A 的历史快照。

本文回答的是：

- `law.muc.edu.cn` 与 `history.muc.edu.cn` 当时为什么被选入首轮扩面批次
- 这轮 batch 当时验证到了什么程度
- 为什么它当时可以进入 baseline batch，但仍不应直接进入 hot lane

本文不负责：

- 充当当前 host enablement truth
- 充当当前 replay / validator runbook
- 继续维护逐轮 crawl artifact 与命令流水

当前应优先阅读：

- `official-web-muc-public-host-survey.md`
- `docs/policies/official-web-crawl-policy.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`

## Historical Snapshot

Batch A 当时只验证两个 host：

- `law.muc.edu.cn`
- `history.muc.edu.cn`

它们被选入的历史原因是：

- 根页可直接访问
- 都是典型公开学院站，而不是动态 shell
- 首页存在稳定站内栏目链接，适合进入静态 source-truth lane

## Historical Validation Result

当时 Batch A 的关键结果固定为：

- crawl：`20` 页全部抓取成功
- source-truth validator：`valid=true`
- QC report：`passPages=20 / reviewPages=0 / failPages=0`
- projection replay：`pages_seen=20 / emitted_documents=20 / manual_review_pages=0`
- projection validator：`valid=true / errors=0 / warnings=0`

family 分布固定为：

- `article_detail = 7`
- `listing_page = 7`
- `directory_page = 6`
- `dynamic_shell_page = 0`
- `structural_shell_page = 0`
- `generic_content_page = 0`

## Historical Host Findings

这轮 batch 还留下了两条有价值的 host-level 结论：

- `law.muc.edu.cn`
  - `szdw1.htm` 及相关 roster family 已能稳定识别为 `directory_page`
  - 法学院 dense roster 页不再被误记成 generic listing
- `history.muc.edu.cn`
  - 首页被识别为 `listing_page`
  - 同日 follow-up 已关闭 listing projection 的重复项、日期噪声、分页控件和工具入口噪音

## Historical Interpretation

这轮 batch 当时证明的是：

- 两个学院站可以进入 `muc_public` baseline source-truth 批次
- 现有 projection declaration 足以覆盖当时出现的 page family
- quality 问题主要落在 listing projection cleanup，而不是 host admission / shell correctness

但它当时并不证明：

- 应立即加入 `scheduler-policy.json` 的 hot lane
- 应扩大 query-serving scope
- 应继续无条件扩 host 范围

## Historical Conclusion

- `law.muc.edu.cn` 与 `history.muc.edu.cn` 的首轮扩面验证已经在 `2026-04-02` 跑通
- `history` 站的 listing noise 随后在同日 follow-up 中被关闭
- 这份 snapshot 的价值在于说明 Batch A 如何证明“可进入 baseline batch”，而不是说明“已经值得进入高频抓取或 serving 面”
