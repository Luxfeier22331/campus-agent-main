# 文档发布任务

`jobs/docs-publish` 负责把已验收的文档读取投影发布为内容寻址的 Campus Docs release，并将指定
release 幂等物化到 `app-api` 的 `docs.*` 读取表。它不是常驻服务，不负责来源采集、浏览器请求或
环境流量选择。

## 命令

```bash
pnpm --dir jobs/docs-publish exec tsx src/cli.ts publish --input-ref ./projection-ref.json
pnpm --dir jobs/docs-publish exec tsx src/cli.ts publish-materialize --input-ref ./projection-ref.json
pnpm --dir jobs/docs-publish exec tsx src/cli.ts verify --release-id sha256:<digest>
pnpm --dir jobs/docs-publish exec tsx src/cli.ts materialize --release-id sha256:<digest>
```

`publish` 和 `verify` 使用 derived object store。`materialize` 与 `publish-materialize` 额外要求
专用 `DOCS_PUBLISH_DATABASE_URL`。对象存储写入是 create-or-verify，数据库按 release 在一个事务
内重建；命令不修改 Cloudflare Worker 流量，也不维护“最新 release”指针。

Kubernetes 一次性 Job base 位于 `infra/k8s/docs-publish/base`。环境仓必须提供：

- `docs-publish-input` ConfigMap：`projection-ref.json`；
- `docs-publish-runtime` ConfigMap：对象存储 endpoint、region、derived bucket，以及
  `DOCS_PUBLISH_DATABASE_CA_CERT_PATH=/etc/docs-publish/database-ca/ca.crt`；
- `docs-publish-secrets` Secret：专用对象存储写凭据和 `docs_publish` 数据库连接；
- `docs-publish-database-ca` Secret：`ca.crt`。

任务不使用 app-api runtime 或 schema owner 凭据。
