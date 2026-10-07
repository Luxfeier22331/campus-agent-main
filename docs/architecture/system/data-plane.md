---
doc_type: architecture
owner_boundary: ingestion-data-plane
status: active
---

# 采集数据面

## 边界

当前采集实现提供显式 CLI，并由通知 Temporal 流水线复用。通知采集产生来源对象并登记数据库库存，文件发布
采集只产生来源对象；采集函数本身不清洗、分类或发布，跨阶段顺序由 `notice-pipeline-worker` 拥有。
交通班车不属于通知采集链路。Ops Web 直接维护 `transport.*` 结构化数据，App API 按日期读取，Campus Web
展示公开投影；它不消费通知，也不成为通用采集编排器。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/ops-web` | TGC 管理、内部凭据 API、通知工作流与 Schedule 的受控操作入口 | 采集与发布实现、工作流阶段编排 |
| `jobs/internal-portal-collection` | 以本地 CLI 或一次性 Job 采集通知、通知资源和文件发布原始对象，并登记通知库存 | TGC 持久化、常驻服务、清洗、分类、发布、PDF 解析 |
| `jobs/notice-classifier` | 读取通知数据库中的标题并写回分类 | 正文清洗、门户栏目判断、发布、自动调度 |
| `jobs/notice-publisher` | 读取已分类库存、校验来源、清洗正文、写入正文与 derived 图片并标记发布 | 定时采集、分类、在线读取 |
| `apps/notice-pipeline-worker` | 串联采集、分类、发布和制品刷新，提供统一通知工作流 | 在线回答与单阶段领域实现 |
| `apps/notice-artifacts-worker` | 执行 Chunk、Embedding、索引发布、清理与回滚活动 | 门户采集和通知分类 |
| `apps/ops-web` | 维护 `transport.*` 线路、完整时间段和班次明细 | 通知采集、学生端读取 |
| `apps/app-api` | 读取 `transport.*` 并按本地日期生成公开班车 projection | 写入班车事实、通知审核 |
| `apps/campus-web` | 通过 App API 展示 `/transport` 页面和日期班次状态 | 直接读取 PostgreSQL、source bucket 或通知声明 |
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

班车展示链路独立于通知发布链路：

```text
Ops Web 维护 transport.routes、schedule_periods、schedule_items
-> App API 按日期选择完整时间段并生成公开投影
-> Campus Web /transport
```

本地命令直接读取受管理 `.env.local` 的 TGC。线上入口先向 Ops Web 解析一条当前可用 TGC，再调用相同
采集实现。集群使用默认暂停的 Temporal Schedule `notice-pipeline` 串联采集、分类、发布和 RAG 刷新；
Ops 手动维护复用固定工作流 ID，文件发布使用独立的 `file-sync` mode。源码保留的单阶段 CronJob 模板
不代表 base 已部署这些资源。具体入口见[采集运行](../../runbooks/ingestion/ingestion.md)。通知 schema 和授权由
[统一 schema Job](../../../jobs/campus-agent-schema/README.md)安装，publisher 使用通知运行角色，不执行 DDL。

## 文件发布采集

```text
file-sync
-> 分页列出文件发布库存
-> 按 ID 顺序逐条下载原始文件
-> source bucket 中的 file 与 source.json
```

已有合法 `source.json` 时跳过该 ID。普通单项失败会汇总后返回非零，认证失败立即终止。当前只保留
原始文件和 metadata，不解析 PDF，不生成 derived 产物。文件发布与通知采集复用同一个本地 CLI、
实现；集群由通知工作流的 `file-sync` mode 调用，不继续分类、发布或索引阶段。

## 凭据

Ops Web 在 PostgreSQL 保存多条具名 TGC 和检查 metadata，并提供人员、automation 与内部解析接口；
internal-portal-collection 只消费解析结果。`ops-web-internal-portal-check` 定时检查凭据，不触发采集，
也不承诺续期。

## 状态分工

- PostgreSQL：`internal_portal.credentials`、`internal_portal.automation_tokens`、`notices.*` 和
  `transport.*`，分别由 Ops Web、通知数据面和班车 Ops Web owner 按权限维护；
- source bucket：门户通知、资源、边界状态、文件发布原始文件和 `source.json`；
- 班车数据不复制通知图片或附件，也不依赖 source bucket；
- derived bucket：通知发布产生的内容寻址图片；
- Temporal：分别承载在线回答与离线通知流水线；两者使用各自的工作流、队列和 Worker。

## 离线索引边界

当前 Docs Chunk builder 只消费 Campus Web 已清洗的 `campus-docs/source.json` 和当前 reader；通知来源
对象、内部门户文件和其他采集产物不能绕过 `notice-publisher` 直接进入 Notice Chunk Run。Docs/Notice
分块与 Embedding 由各自显式 Job 完成，并通过内容寻址制品交接；统一 Campus RAG publisher 再把两套
Embedding Set 组装为一个 collection，并作为唯一写入者更新 `campus_docs_serving.current_index`。在线
Agent 只通过 `campus_search` 读取已发布的当前 collection。

部署清单存在只表示期望状态；实际运行以环境仓选择和控制器状态为准。

## 相关文档

- [对象存储](../../../.agents/notes/implemented/architecture/2026-07-16-object-storage.md)
- [退役旧文档分块栈](../../../.agents/notes/implemented/simplification/2026-08-21-retire-document-chunking-stack.md)
- [简化采集控制面与内部门户凭据所有权](../../../.agents/notes/implemented/simplification/2026-08-19-internal-portal-credential-resolution.md)（采集控制面退役与当前凭据所有权的理由）
- [内部门户数据](../../data/internal-portal.md)
- [通知数据](../../data/notices.md)
- [采集运行](../../runbooks/ingestion/ingestion.md)
