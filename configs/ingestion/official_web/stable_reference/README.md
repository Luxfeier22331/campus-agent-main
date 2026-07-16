# stable_reference 集合配置

本目录定义离线 `official_web/stable_reference` collection，用于机构、院系和联系方式等长期
有效的公开网页。

## 当前边界

- `serving-config.json` 为 `offline_preparation`，retrieval 关闭；
- 该 collection 不在 `configs/runtime/query-serving-targets.v1.json` 中，`knowledge_query`
  不能选择或搜索它；
- serving config 中的 Qdrant 名称只保留 artifact identity，不表示在线 alias 已存在；
- 正式 regulation 与 curriculum document 留在各自 corpus。

## 采集

该 collection 没有可执行 task registry。`official_web.capture` 只生成 source artifact 与 URL
freshness state。canonical document、chunk/index、release 与 serving publication 全部实现后，
才可增加可执行 task 或进入在线 target。
