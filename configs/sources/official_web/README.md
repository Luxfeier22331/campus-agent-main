# Official Web 来源配置

本目录保存 Official Web 离线采集的站点配置。配置由 source-collector 加载和校验，不是在线查询
目标、文档发布或检索配置。

每个站点目录可以包含：

- `site.json`、`hosts.json`、`seeds.json`：站点、允许访问的主机和初始网址；
- `crawl-policy.json`、`scheduler-policy.json`、`qc-policy.json`：抓取、调度和质量策略；
- `credentials.schema.json`：运行时凭据结构，不保存凭据；
- `source-packs/`、`target-source-map.json`、`target-inventory.json`：有明确采集目的的离线抓取清单与匹配规则；
- `consumer-denominator.json`：页面分类和来源产物保留规则；
- `projection-declarations.json`：页面类别的离线处理提示。

具体主机、预算、周期、匹配词和保留动作只由 JSON 配置维护。采集完成不代表规范文档、索引、
release 或在线知识目标已经存在。

采集链路和在线边界见 `docs/domains/official-web.md`。
