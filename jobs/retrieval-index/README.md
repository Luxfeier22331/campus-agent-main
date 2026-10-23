# 检索索引 Job

`retrieval-index` 是 Docs 与已发布 Notices 的统一离线索引入口。一个镜像提供 `build`、`apply`、
`cleanup` 三个一次性命令；通知采集、分类和正文发布继续由 `notice-pipeline-worker` 承担。

## 命令

```bash
pnpm dev:init -- --target retrieval-index
pnpm --filter retrieval-index typecheck
pnpm --filter retrieval-index test:unit
pnpm --filter retrieval-index build
```

本地运行 `pnpm --filter retrieval-index exec node --env-file=.env.local --import=tsx src/cli.ts <命令>`。
生产镜像入口为 `node dist/cli.js`，只接受一个命令参数；以下输入由运行该 Job 时显式提供。

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `build` | `RETRIEVAL_BUILD_SOURCE=docs/notices/both`；可选 `CAMPUS_DOCS_REUSE_EMBEDDING_SET`、`CAMPUS_NOTICE_REUSE_EMBEDDING_SET` | 各来源的 Embedding Set ID、Chunk/Embedding 数及生成/复用数 |
| `apply` | `CAMPUS_DOCS_EMBEDDING_SET`、`CAMPUS_NOTICE_EMBEDDING_SET` | collection、revision、是否无操作、已退休 collection、point 数 |
| `cleanup` | 逗号分隔的 `RETRIEVAL_CLEANUP_DOCS_SETS`、`RETRIEVAL_CLEANUP_NOTICE_SETS`，至少一项 | 已删除对象数 |

Build 读取一次 Model Config，在同一连接和模型空间下生成制品。Notice 从 repeatable-read 快照游标
读取已发布正文，Docs 逐篇读取 reader；分块复用既有领域实现。Embedding 串行分批执行，上限不超过
现有 provider 批大小。旧向量只从显式指定的同模型 Embedding Set 复用。

## 内存与存储

生产制品读取使用流式 NDJSON；Chunk、文本去重、向量关联和目标 point 放在 Job 私有 SQLite
工作区。缓存限制为 16 MiB，排序落盘；不会构造完整向量 Map 或完整 points 数组。Docs source.json
仍是现有的元数据清单，正文 reader 逐篇处理。输出按既有内容寻址和规范序列化规则写入 derived
bucket。`RETRIEVAL_WORK_DIR` 指定磁盘工作目录，默认 `var/retrieval-work`；集群使用 20 GiB 的 Pod 临时卷，
每次运行结束即删除。
超过 16 MiB 的 NDJSON 使用串行 multipart 上传，每个上传缓冲区不超过 16 MiB。

## 应用与清理

每个 revision 对应一个不可变 collection `campus_docs_<revision>`，名称由两个 Embedding Set 与
collection definition 推导，与旧 publisher 一致。Apply 先准备制品，再持有 publisher 锁：

1. current_index 已指向目标 collection 时不写入；
2. 否则写入目标 collection（遗留的不完整同名 collection 删除后重建），校验 point 数、payload 与双向量；
3. 在一个事务中更新 current_index 的 collection 与制品引用；
4. 等待 90 秒宽限期后删除上一个 collection。

每批最多 64 个 point、8 MiB，写入并发为 1。Search 每个请求读取一次指针，不持锁；切换前失败时旧
collection 继续服务。没有回滚路径，需要旧内容时用旧 Embedding Set 再次 Apply。

Cleanup 仅处理显式指定的退休 Embedding Set；当前引用和其他保留 manifest 保护共享对象。它不构造
point、不删除共享 Embedding cache、不自动清理未完成构建。先删除数据，再删除 Chunk manifest，
最后删除 Embedding Set 根 manifest。中途失败后重新执行相同命令，已删除的目标对象按已完成处理；
保留制品缺失或权限、网络错误仍中止。三个 Job 由 publisher advisory lock 互斥。

本地 `import-artifacts-local` 与 `publish-index-local` 继续提供手动导入和发布入口；小型开发 fixture
的组装与导入不作为生产 Job 的内存处理路径。

## 验证

单元测试覆盖流式读取、批次边界、向量复用和 collection 命名。集成测试显式使用隔离数据库和 Qdrant：

```bash
RETRIEVAL_TEST_DATABASE_URL=... RETRIEVAL_TEST_QDRANT_URL=... \
RETRIEVAL_TEST_QDRANT_KEY=... pnpm --filter retrieval-index test:integration
```

集成测试会重建指定测试数据库中的 `campus_docs_serving` schema，并删除它创建的测试 collection。

## 相关文档

- [检索服务架构](../../docs/architecture/system/retrieval-serving.md)
- [索引维护操作](../../docs/runbooks/ingestion/campus-docs.md#检索索引-job)
- [职责调整决策](../../.agents/notes/implemented/architecture/2026-10-14-retrieval-index-jobs.md)
