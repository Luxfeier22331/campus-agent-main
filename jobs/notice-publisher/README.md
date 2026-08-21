# 通知发布器

`notice-publisher` 是来源通知进入 `notices.*` 规范化投影的唯一显式写入入口。默认运行从 source bucket
读取来源通知，从 derived bucket 读取 `notices/classifications/<notice-id>.json` 分类制品，校验完整库存后
清洗正文和资源，再用一个 PostgreSQL 事务写入通知、映射和资源 metadata。分类必须使用共享通知合同
中的值，`unclassified` 也是可正常发布的分类。

发布器不抓取外部网页、不自动调度、不保存分类模型 metadata，也不创建批次状态。图片按 SHA-256
写入 derived bucket；附件只校验 source bucket 中的原始字节并写 metadata，不复制到 derived bucket。
外链通知只发布来源 metadata 和 URL，不读取或物化门户包装正文及资源。相同输入可以幂等重跑；来源、
分类库存、schema 或已有投影冲突时整批失败。

单分类 migration 5 只接受空的 `notices.notices` 投影。它不会把旧分类值映射到新 taxonomy，也不会
保留兼容列；已有本地旧投影应先按 runbook 清空，再运行 migration 和重新发布。

## 运行

先按 `docs/runbooks/ingestion.md` 完成来源采集和分类，再运行本地 migration。默认发布读取当前
source/derived bucket 中的在线制品格式：

```bash
set -a
. apps/app-api/.env.local
set +a
NOTICES_DATABASE_URL="$APP_API_SCHEMA_DATABASE_URL" pnpm --filter notice-publisher migrate

pnpm --filter notice-publisher run publish --notice-id 123456
```

本地模型比较产生的 JSONL 仍可作为显式开发输入：

```bash
pnpm --filter notice-publisher run publish \
  --classifications /absolute/path/to/classifications.jsonl \
  --notice-id 123456
```

运行时提供 `NOTICES_DATABASE_URL`，或标准 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、
`PGPASSWORD`；数据库 TLS 由 `NOTICES_DATABASE_SSLMODE` 和
`NOTICES_DATABASE_CA_CERT_PATH` 维护。门户 hostname 直接读取
`configs/sources/internal-portal.json`，不再维护重复环境变量。对象存储使用
`OBJECT_STORE_ENDPOINT`、`OBJECT_STORE_BUCKET_SOURCE`、`OBJECT_STORE_BUCKET_DERIVED`，以及
`OBJECT_STORE_SOURCE_ACCESS_KEY` / `OBJECT_STORE_SOURCE_SECRET_KEY` 和
`OBJECT_STORE_DERIVED_ACCESS_KEY` / `OBJECT_STORE_DERIVED_SECRET_KEY` 两套身份。发布器通过 source
身份只读取来源，通过 derived 身份读取分类制品并写入通知图片，不使用跨 bucket 的管理身份。

Kubernetes base 包含 wave 0 的 schema Job 和默认暂停的 `notice-publisher` CronJob 模板。schema 与
publisher 都复用既有 `campus_agent` owner Secret；不创建线上 `notice_publisher` 角色、专用密码或
自动 schedule。全量发布直接从模板创建一次性 Job：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-publisher <job-name>
```

代表性发布在本次 Job 上替换参数，不修改 CronJob：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-publisher <job-name> \
  --dry-run=client -o yaml |
kubectl patch --local -f - --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["publish","--notice-id","123456"]}]' \
  -o yaml |
kubectl -n <namespace> create -f -
```

历史附件链接回填、产品验收和仅限本地的投影重建由 runbook 统一维护。数据字段、正文清洗和资源
所有权见 `docs/data/notices.md`。

## 验证

```bash
pnpm --filter notice-publisher typecheck
pnpm --filter notice-publisher test
pnpm --filter notice-publisher test:migration-integration
```
