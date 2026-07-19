---
doc_type: index
owner_boundary: docs/data
status: active
---
# 数据文档

`docs/data/` 保存逻辑数据结构、来源和读取模型所有权。

- App API 产品数据：[app-api/README.md](./app-api/README.md)；
- 持久执行投影：[durable-runtime.md](./durable-runtime.md)；
- 文档内容：[document-reader.md](./document-reader.md)、
  [internal-portal.md](./internal-portal.md)、[wechat-official.md](./wechat-official.md)；
- 校园服务：[dining.md](./dining.md)；
- 数据库所有权：[postgres-ownership.md](./postgres-ownership.md)。

班车的人类可读事实由 [transport.md](../domains/transport.md) 维护；机器 schema 位于
`packages/contracts/schemas/`。迁移历史和操作步骤不在本目录重复。
