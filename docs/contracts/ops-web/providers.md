---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Provider Config 接口

## 读取

`GET /api/ops/provider-config` 返回 active revision、connection revisions、profiles、在线 role
状态、采样时间和当前 principal 的 `writeAllowed`。role 只允许 `primary_agent`、
`rag_query_embedding` 和可选 `rag_reranker`。connection 只暴露 API key 末四位和 fingerprint，
不返回密钥或密文。

## 写入

四类 `POST` 命令分别创建不可变 connection revision、创建 profile、验证 profile 和激活完整
bundle。每次命令必须满足：

- 当前 principal 是独立写白名单中的人员；
- Origin 与服务端配置的公开 origin 一致，正文为 JSON；
- `Idempotency-Key` 非空且不超过 200 字符；
- 激活提供当前 `expectedRevision`，包含 required role，并只引用验证通过的 profile。

Ops Web 将人员标识和幂等键转发给 execution-control admin。上游冲突、校验和失败状态原样保留，
不转换为成功空数据；浏览器不能指定 admin URL、token、数据库角色或 keyring。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
