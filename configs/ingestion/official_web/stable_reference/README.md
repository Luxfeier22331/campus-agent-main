# stable_reference 配置

本目录保存机构、院系、服务入口和联系方式等长期有效公开网页的离线集合配置。正式规章和培养
方案由各自领域集合维护。

## 文件

- `split-manifest.v1.json`：公开合成逻辑文档边界；
- `chunk-profile.json`：规范文档分块配置；
- `serving-config.json`：集合身份、索引兼容和查询状态。

采集器负责保存来源产物和新鲜度观测；规范化、发布和在线查询能力必须分别由可执行任务与运行
注册表证明。本 README 不把索引名称或配置文件存在解释为已发布能力。

来源范围见 `docs/domains/official-web.md`，采集入口见 `apps/source-collector/README.md`。
