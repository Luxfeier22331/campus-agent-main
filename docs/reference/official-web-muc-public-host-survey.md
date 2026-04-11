---
doc_type: reference
status: historical
created: 2026-03-28
updated: 2026-04-12
---

# Official Web MUC Public Host Survey

## 文档边界

本文不定义 `official_web` 的长期 crawl policy 或 source-truth contract，只记录 `muc_public` 首版站点盘点的当前事实快照，供后续 `configs/sources/official_web/muc_public/` 建站点配置时直接消费。

当本文与以下文档冲突时：

- 长期 source-channel 边界以 `docs/architecture/official-web-architecture.md` 为准
- crawl policy 以 `docs/policies/official-web-crawl-policy.md` 为准
- source-truth contract 以 `docs/architecture/official-web-source-truth-contract.md` 为准

## 调查时间

- 调查执行时间：2026-03-28（Asia/Shanghai）

## 调查方法

- 读取 `https://www.muc.edu.cn/` 首页导航、卡片区和快捷入口
- 从首页出链中提取 `muc.edu.cn` 相关 host 集合
- 点检代表性 host 的首页内容形态，区分公开内容站、目录站、portal 和 app shell
- 直接检查已知敏感 host 的 `robots.txt`

## 观测摘要

### 首页出链结果

- `https://www.muc.edu.cn/` 首页共暴露 44 个不同 host
- 其中 `muc.edu.cn` 相关 host 共 34 个
- 首页并未暴露“可直接把整个 `*.muc.edu.cn` 放开”的证据；当前正确做法仍是显式 host allowlist

### robots / sitemap 结果

- `https://www.muc.edu.cn/robots.txt` 于 2026-03-28 返回 `404`
- `https://www.muc.edu.cn/sitemap.xml` 于 2026-03-28 返回 `404`
- `https://service.muc.edu.cn/robots.txt` 于 2026-03-28 返回：
  `User-agent: *`
  `Disallow: /`
- 因此 `service.muc.edu.cn` 当前不得进入首版公开 crawl scope

### 代表性点检

- `https://news.muc.edu.cn/` 返回公开新闻内容，适合作为 `content_site`
- `https://xxgk.muc.edu.cn/` 返回信息公开目录与受理信息，适合作为 `directory_site`
- `https://lib.muc.edu.cn/` 返回图书馆公开站点首页，首版可作为 `directory_site`
- `https://xiaoyou.muc.edu.cn/` 返回校友会基金会公开站点首页，可纳入公开内容 host
- `http://my.muc.edu.cn/` 在首页中以“信息门户”出现，且首页链接仍为 `http`，应按 `portal` 对待，首版不纳入公开 crawl scope
- 多个学院 / 专题子站首页均返回公开新闻或栏目内容，说明它们是显式公开内容站，而不是仅登录态应用壳

## `muc_public` 首版 host 结论

### 纳入首版 allowlist 的 host

以下 host 建议在 `muc_public` site config 中纳入显式 allowlist，并按建议 `public_kind` 建模。

#### `directory_site`

- `www.muc.edu.cn`
- `xxgk.muc.edu.cn`
- `lib.muc.edu.cn`

#### `content_site`

- `news.muc.edu.cn`
- `xiaoyou.muc.edu.cn`
- `art.muc.edu.cn`
- `cie.muc.edu.cn`
- `cles.muc.edu.cn`
- `dd9.muc.edu.cn`
- `eco.muc.edu.cn`
- `edu.muc.edu.cn`
- `gjaqyjy.muc.edu.cn`
- `history.muc.edu.cn`
- `law.muc.edu.cn`
- `lxy.muc.edu.cn`
- `marxism.muc.edu.cn`
- `ms.muc.edu.cn`
- `msy.muc.edu.cn`
- `muchnic.muc.edu.cn`
- `phil.muc.edu.cn`
- `sce.muc.edu.cn`
- `scemll.muc.edu.cn`
- `sfs.muc.edu.cn`
- `sla.muc.edu.cn`
- `sport.muc.edu.cn`
- `tjcz.muc.edu.cn`
- `wd.muc.edu.cn`
- `xinchuan.muc.edu.cn`
- `xingong.muc.edu.cn`
- `yuke.muc.edu.cn`
- `yxy.muc.edu.cn`
- `yyxy.muc.edu.cn`
- `zlzhmzgtt.muc.edu.cn`

这些 host 的共同特征是：

- 明确从 `https://www.muc.edu.cn/` 首页公开导航、快捷入口或内容区出链可达
- 首页点检呈现为公开新闻、栏目、学院或专题内容
- 当前没有发现像 `service.muc.edu.cn` 那样的明确 `Disallow: /` 信号

### 首版明确排除或禁用的 host

#### `portal`

- `my.muc.edu.cn`

排除原因：

- 首页文案就是“信息门户”
- 当前首页出链是 `http://my.muc.edu.cn/`，不满足首版 `https` admission 基线
- 该 host 形态更接近个人门户 / 登录态入口，而不是公开内容站

#### `app_shell`

- `service.muc.edu.cn`

排除原因：

- `robots.txt` 当前明确 `Disallow: /`
- 该 host 在仓库既有语义中也更接近服务目录 / 应用壳，而不是首版公开 HTML 内容站

#### 第三方域名

以下 host 虽然从官网首页可跳转，但不属于 `muc.edu.cn` 官方站内 host allowlist：

- `app2.gmdaily.cn`
- `b23.tv`
- `beian.miit.gov.cn`
- `mobile.bjd.com.cn`
- `mp.weixin.qq.com`
- `mr.baidu.com`
- `profile.zjurl.cn`
- `weibo.com`
- `www.peopleapp.com`
- `www.yspapp.cn`

这些域名在 `muc_public` 首版一律排除。

## 首版配置含义

这份 survey 固定的是 host allowlist 候选集合，不等于后续每个 host 的最终 path policy。

后续 `hosts.json` / `seeds.json` 仍需分别补齐：

- `allowed_path_prefixes`
- `denied_path_patterns`
- `query_param_allowlist`
- `respect_robots`
- `explicit_sitemaps`
- `max_depth`
- `max_pages_per_run`

## 可追溯观测来源

- `https://www.muc.edu.cn/`
- `https://www.muc.edu.cn/robots.txt`
- `https://www.muc.edu.cn/sitemap.xml`
- `https://service.muc.edu.cn/robots.txt`
- `https://news.muc.edu.cn/`
- `https://xxgk.muc.edu.cn/`
- `https://lib.muc.edu.cn/`
- `https://xiaoyou.muc.edu.cn/`
- `http://my.muc.edu.cn/`
- 以及首页直接出链到的公开学院 / 专题子站首页
