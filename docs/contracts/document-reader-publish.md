---
doc_type: contract
owner_boundary: docs/contracts
status: active
---

# 文档阅读器发布合同

## 文档边界

本文定义 Campus Docs 阅读投影从对象存储发布、物化到 App API、构建进 Campus Web Worker，
再由 GitOps 选择上线的完整合同。正文资产格式见文档阅读器数据模型，环境凭据由环境仓和密钥
系统维护。

## 发布链

```text
规范文档与阅读器资产
-> 已验收的 campus_docs_app_projection.v1 对象
-> jobs/docs-publish
-> 内容寻址的 Campus Docs release
-> release-scoped docs.* 投影
-> source SHA + docsReleaseId 构建 Campus Web Worker
-> GitOps PR 同时选择 Worker version 与 docs release
```

对象存储保存长期发布事实；`docs.*` 是按 release 物化的浏览器读取投影；Rspress 页面和
`/_docs/*`、`/_gated-docs/*`、`/_gated-docs-search/*` 是某个 Worker version 内的静态复制品。
任何一层都不得反向成为规范文档。

## 可执行合同

发布面由以下 schema 冻结：

- `campus-docs-app-projection.v1.schema.json`：发布任务的已验收输入；
- `campus-docs-release-manifest.v1.schema.json`：静态构建与投影物化共享的 release manifest；
- `campus-docs-release-ref.v1.schema.json`：跨步骤传递的内容寻址 release identity。

manifest 使用 canonical JSON：对象键递归排序、数组按领域稳定键排序、UTF-8、两个空格缩进、
末尾一个换行。manifest 不包含 `generatedAt` 或其他随执行变化的字段。

## 内容寻址

```text
releaseId = sha256:<manifest 精确字节的 SHA-256>
manifest key = docs-reader/releases/sha256/<digest>/manifest.json
projection key = docs-reader/projections/sha256/<projection-digest>.json
```

对象引用统一为：

```json
{
  "key": "docs-reader/projections/sha256/abc.json",
  "sha256": "sha256:...",
  "byteSize": 1234
}
```

发布只允许 create-or-verify：同一 key 已存在时必须逐字节摘要和长度一致，不得覆盖或维护
`latest` 指针。manifest、projection 或 reader asset 不存在、摘要不一致时立即失败。

## 发布任务

`jobs/docs-publish` 是一次性 Job，不是常驻应用，也不是 CronJob：

```bash
pnpm --dir jobs/docs-publish exec tsx src/cli.ts publish --input-ref ./projection-ref.json
pnpm --dir jobs/docs-publish exec tsx src/cli.ts publish-materialize --input-ref ./projection-ref.json
pnpm --dir jobs/docs-publish exec tsx src/cli.ts verify --release-id sha256:<digest>
pnpm --dir jobs/docs-publish exec tsx src/cli.ts materialize --release-id sha256:<digest>
```

`publish-materialize` 先创建或验证不可变对象，再把同一个 release 单事务物化到 PostgreSQL。
Kubernetes base 位于 `infra/k8s/docs-publish/base`；环境仓提供 projection ref ConfigMap、对象存储
配置、专用写凭据、`docs_publish` 数据库连接和 CA。任务成功日志中的
`campus_docs_release_ref.v1` 是后续候选构建输入。

## App API 投影

`docs.releases` 记录已物化 release，其他 `docs.*` 表全部以 `release_id` 参与主键、外键和索引。
同一 release 重跑时在一个事务内删除该 release 的旧投影并完整重建；其他 release 不受影响。

- `docs_publish` 对 `docs.*` 拥有最小 DML 权限；
- `app_api` 对 `docs.*` 只有读取权限；
- Campus Web 构建和浏览器都不连接数据库；
- App API 不导出、不发布也不选择 docs release。

Campus Web Worker 对所有 `/api/docs/*` 请求注入：

```text
x-campus-docs-release: sha256:<64 lowercase hex>
```

浏览器提供的同名 header 必须丢弃。App API 缺少或收到非法 release header 时返回
`503 docs_release_unavailable`；所有查询和 readiness 只读取该 release。

## Campus Web 构建

release build 只有一个选择参数：

```bash
pnpm --dir apps/campus-web build:release --release-id sha256:<digest>
pnpm --dir apps/campus-web build:staging --release-id sha256:<digest>
```

构建入口由 release ID 推导 manifest key 和期望摘要，只从对象存储读取一次 manifest bytes，
验证后固定为本地临时文件，再生成 Rspress 页面和静态资产。它不接受 manifest key、manifest
path、单独 SHA 文件或数据库连接参数。

本地开发和浏览器回归使用 `build:docs:fixture`，不伪造 production release，也不访问对象存储。

## Worker 候选与 GitOps

Campus Web 候选必须记录：

- `sourceSha`：完整源码提交 SHA；
- `docsReleaseId`：构建所用 Campus Docs release；
- `buildIdentity = sha256(sourceSha + "\\n" + docsReleaseId + "\\n")`；
- Cloudflare `versionId`。

Worker upload tag 使用 `build-<buildIdentity digest>`。GitOps 的
`cloudflare/staging/docs-reader-release.json` 采用：

```json
{
  "schemaVersion": "campus_docs_release_ref.v1",
  "releaseId": "sha256:..."
}
```

常规源码构建读取 GitOps 已选 release；手动构建可以显式提交新的 `docs_release_id`。promotion
必须在同一 PR 中写入 Worker candidate 的四个标识和 `docs-reader-release.json`，并重新计算
`buildIdentity`。不得通过 GitHub Environment variable、手工 manifest key/SHA 对或“最新对象”
选择文档版本。

## 回滚与清理

回滚选择已知的 Worker version 及其记录的同一个 `docsReleaseId`。只切 Worker 或只切 release
会造成静态资产与 App API 投影不一致，必须拒绝。

release 对象与 `docs.*` 历史投影允许并存。垃圾回收只能在确认没有 GitOps 环境、保留的 Worker
candidate、回滚窗口或审计记录引用后执行；本合同不定义自动清理任务。

## 禁止形态

- App API 数据库反向导出发布 manifest；
- Campus Web 构建连接 App API 数据库；
- 以 env variable 保存 manifest key、manifest digest 或“当前文档版本”；
- 覆写内容寻址对象、扫描对象存储猜测最新版本或静默回退；
- release-scoped 表之外的双写、兼容表或无 release 查询；
- 让浏览器控制 `x-campus-docs-release`。

## 相关文档

- [文档站架构](../architecture/system/document-site.md)
- [App API 文档接口](./app-api/document-reader.md)
- [文档阅读器数据模型](../data/document-reader.md)
- [运行时发布](../architecture/system/runtime-release.md)
- [发布操作](../runbooks/release.md)
