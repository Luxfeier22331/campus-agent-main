---
doc_type: architecture
owner_boundary: ingestion-data-plane
status: active
---

# 采集数据面

## 边界

当前采集数据面由显式 CLI 和可复用 Job 入口组成。通知采集产生来源对象并登记数据库库存，文件发布
采集只产生来源对象；采集不自动清洗、分类、发布产品投影或开放查询目标，也不维护通用任务状态。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/ops-web` | TGC 持久化、真实验证、定时检查、候选解析、人员管理和内部凭据 API | 采集编排、Temporal、对象存储、通知发布 |
| `jobs/internal-portal-collection` | 以本地 CLI 或一次性 Job 采集通知、通知资源和文件发布原始对象，并登记通知库存 | TGC 持久化、常驻服务、清洗、分类、发布、PDF 解析 |
| `jobs/notice-classifier` | 读取通知数据库中的标题并写回分类 | 正文清洗、门户栏目判断、发布、自动调度 |
| `jobs/notice-publisher` | 读取已分类库存、校验来源、清洗正文、写入正文与 derived 图片并标记发布 | 定时采集、分类、在线读取 |
| `packages/internal-portal-client` | CAS 跳转、门户 Cookie 会话、TGC 校验和错误分类 | 配置、凭据存储和采集业务 |
| `packages/ingestion-contracts` | 当前来源对象与同步边界 JSON 合同 | 任务注册表、工作流和供应商客户端 |

## 通知采集

```text
notice-sync / notice-backfill
-> 门户列表与详情
-> 原始通知、图片、附件和边界状态写入 source bucket
-> 通知类型、组织和通知库存登记到 notices.*
-> 独立模型分类
-> 分类写回通知数据库
-> notice-publisher 显式清洗并写入正文、资源 metadata 和发布状态
```

本地命令直接读取受管理 `.env.local` 的 TGC。线上入口先向 Ops Web 解析一条当前可用 TGC，再调用相同
采集实现。ingestion runtime base 为通知增量、通知回填和文件发布分别提供一个默认暂停的
CronJob 模板；维护者显式创建一次性 Job，不启用自动 schedule，也不与分类自动串联。notice-publisher
同样只提供默认暂停的一次性 Job 模板；它默认消费数据库中的待发布通知，并复用数据库 owner 完成 schema
安装和显式物化，不新增线上 publisher 身份。

## 文件发布采集

```text
file-sync
-> 分页列出文件发布库存
-> 按 ID 顺序逐条下载原始文件
-> source bucket 中的 file 与 source.json
```

已有合法 `source.json` 时跳过该 ID。普通单项失败会汇总后返回非零，认证失败立即终止。当前只保留
原始文件和 metadata，不解析 PDF，不生成 derived 产物。文件发布与通知采集复用同一个本地 CLI、
镜像和暂停 Job 模板。

## 凭据

Ops Web 在 PostgreSQL 保存多条具名 TGC 和检查 metadata，并提供人员、automation 与内部解析接口；
internal-portal-collection 只消费解析结果。`ops-web-internal-portal-check` 定时检查凭据，不触发采集，
也不承诺续期。

## 状态分工

- PostgreSQL：`internal_portal.credentials`、`internal_portal.automation_tokens` 和 `notices.*`，由
  Ops Web 与通知所有者分别维护；
- source bucket：门户通知、资源、边界状态、文件发布原始文件和 `source.json`；
- derived bucket：通知发布产生的内容寻址图片；
- Temporal：只服务 execution-control 的在线执行，不再承载 ingestion 采集。

## 离线索引边界

当前 Docs Chunk builder 只消费 Campus Web 已清洗的 `campus-docs/source.json` 和当前 reader；通知来源
对象、内部门户文件和其他采集产物不能绕过 `notice-publisher` 直接进入 Notice Chunk Run。Docs/Notice
分块与 Embedding 由各自显式 Job 完成，并通过内容寻址制品交接；统一 Campus RAG publisher 再把两套
Embedding Set 组装为一个 collection，并作为唯一写入者更新 `campus_docs_serving.current_index`。在线
Agent 只通过 `campus_search` 读取已发布的当前 collection。

部署清单存在只表示期望状态；实际运行以环境仓选择和控制器状态为准。

## 相关文档

- `docs/decisions/adr-0002-object-storage.md`
- `docs/decisions/adr-0091-retire-document-chunking-stack.md`
- `docs/decisions/adr-0089-internal-portal-credential-resolution.md`（历史决策，现行 owner 已迁移到 Ops Web）
- `docs/data/internal-portal.md`
- `docs/data/notices.md`
- `docs/runbooks/ingestion.md`
