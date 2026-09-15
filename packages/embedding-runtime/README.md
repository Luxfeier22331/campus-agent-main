# embedding-runtime

`packages/embedding-runtime` 拥有检索索引共享的嵌入模型空间合同和 OpenAI 兼容客户端。

负责：

- 固定规范嵌入模型与向量空间（`Qwen3-Embedding-4B`、2560 维和 `EMBEDDING_SPACE` 标识）；
- 嵌入服务 base URL 规范化（绝对无凭据 HTTP(S) 地址，loopback 之外强制 HTTPS）与 target
  sha256 计算，供索引 manifest 校验连接一致性；
- OpenAI 兼容 `/embeddings` 客户端，以及固定批量（每请求 8 条、并发 8）的批处理、维度和
  顺序完整性校验。

不负责 provider 部署与运维、索引写入、API key 存储和检索后端细节。消费者为
`jobs/campus-docs-index-publisher`、`jobs/campus-rag-index-publisher` 和
`jobs/notice-index-publisher`。

```bash
pnpm --dir packages/embedding-runtime typecheck
pnpm --dir packages/embedding-runtime test
```
