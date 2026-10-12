# Search API Go 合同

Campus Search 与 Agent Control 共享搜索结果 wire、编解码及引用规则。
包只依赖 Go 标准库，不包含检索、索引存储、网络客户端或执行编排。

`go test ./packages/search-api-go/...` 验证结果编解码和引用合同。
