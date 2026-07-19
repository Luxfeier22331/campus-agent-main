# fresh_news 配置

本目录保存新闻、通知、活动和讲座等时效性公开网页的离线集合配置。

## 文件

- `split-manifest.v1.json`：公开合成逻辑文档边界；
- `serving-config.json`：集合身份、索引兼容和查询状态。

采集器负责保存来源产物和新鲜度观测；规范化、发布和在线查询能力必须分别由可执行任务与运行
注册表证明。本 README 不复制当前开放状态或未来实施清单。

来源范围见 `docs/domains/official-web.md`，采集入口见 `apps/source-collector/README.md`。
