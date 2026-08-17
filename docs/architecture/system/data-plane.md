---
doc_type: architecture
owner_boundary: ingestion-data-plane
status: active
---

# 采集数据面

## 边界

采集数据面包含注册的确定性文件任务、按 ID 执行的内部门户文件发布采集，以及本地通知采集。
这些入口共享对象存储和来源适配器，但不强行进入同一任务模型。采集完成不会自动创建产品读
模型、知识索引或切换 Campus Docs 当前索引。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/ingestion-control` | 注册任务准入、Temporal workflow、Rust kernel 投影；文件发布 workflow 提交与状态查询 | 门户 HTTP、通知同步、在线发布 |
| `apps/source-collector` | 文件发布 Activity、本地通知命令、原始通知资源回填和一次性本地认证检查 | TGC 持久化或保活、注册任务准入、通知发布 |
| `jobs/notice-publisher` | 校验来源、清洗正文、显式写入规范化通知和 derived 资源 | 定时采集、分类、在线读取 |
| `packages/internal-portal-client` | CAS 跳转、门户 Cookie 会话、TGC 校验和错误分类 | 配置、凭据存储、调度和采集业务 |
| `packages/ingestion-contracts` | 跨运行时 JSON Schema 与校验器 | 工作流、存储和供应商客户端 |
| `packages/ingest-core` | 对象引用、摘要、registry 与内核输入输出辅助能力 | Temporal、数据库和门户实现 |
| `packages/ingestion-kernels-rs` | 确定性校验与分块 | 网络、数据库、对象存储和工作流编排 |

## 注册任务

```text
带摘要的对象引用
-> ingestion-control 按 registry 冻结 Rust kernel 任务
-> Temporal workflow
-> Rust kernel Activity
-> 对象存储结果
-> PostgreSQL 有界任务投影
```

registry 只声明 Rust kernel。Temporal 维护 workflow 历史、重试、超时、心跳与取消；PostgreSQL
只保存任务查询所需的投影，不保存详细处理过程。结果对象必须通过摘要引用，任务完成不会触发
知识发布。

## 文件发布

```text
获准的内部调用提交精确文件发布 ID
-> ingestion-control 启动每 ID 一个 workflow
-> source-collector Activity
-> source bucket 中的 file 与 source.json
-> Temporal workflow result
```

文件发布 workflow 不是注册任务，不写 PostgreSQL 任务、发布流或检查点，也没有父子 workflow、
TypeScript 物化、离线 release 或 derived 产物。提交方保存响应中的 workflow ID，并通过
ingestion-control 的固定状态接口查询 Temporal 状态。当前 Ops Web 不提供文件发布入口。

## 通知

通知使用 source-collector 本地命令采集来源对象和原始资源，人工确认唯一领域后由 publisher 显式
写入规范化投影。App API 和 Campus Web 只读该投影。通知不进入 Temporal、任务注册表或 Ops API，
也不创建采集批次、自动分类、自动发布或双写。数据结构和操作顺序分别见
`docs/data/notices.md` 与 `docs/runbooks/ingestion.md`。

## 认证检查

Ops Web 在 PostgreSQL 保存多条具名 TGC，并由同镜像 CronJob 每 30 分钟顺序建立门户会话、记录
结果和 CAS 可能返回的当前值。该检查不保证延长 TGC 生命周期；明确拒绝的记录暂停定时检查，轮换
或人工检查成功后恢复，依赖检查失败则在下一周期继续。检查不触发采集、不写对象存储，也不进入
Temporal。source-collector 只在本地命令或显式启动的进程中消费开发者从 Ops Web 取出的直接值；
它不读取 Ops Web 数据库，也不维护第二份认证状态。

## 状态分工

- Temporal：注册任务和文件发布 workflow 状态；
- PostgreSQL：注册 Rust 任务投影与 `notices.*` 规范化通知数据，两者由不同角色和 schema 所有；
- source bucket：门户通知、门户名称映射、通知边界、原始通知资源、文件发布原文件和来源 metadata；
- derived bucket：注册 Rust kernel 的确定性输出，以及通知的 SHA-256 内容寻址资源。

## 在线检索边界

规范文档单元可以通过注册的 `build-retrieval-chunks-v2` 任务生成确定性的
`retrieval_chunk_set.v2`。这些注册任务及其产物仍属于独立 ingestion 数据面，不是当前 Campus Docs
RAG publisher 的输入，也不会自动写入 Qdrant 或推进在线索引。

当前文档检索只消费 Campus Web 已清洗的 `campus-docs/source.json` 和当前 reader。通知来源对象、
内部门户文件、canonical 单元和 Rust 检索分块都不能绕过该输入边界直接进入在线索引。

部署清单存在只表示期望状态；实际运行以环境仓选择和控制器状态为准。

## 相关文档

- `docs/decisions/adr-0002-object-storage.md`
- `docs/decisions/adr-0077-ingestion.md`
- `docs/data/internal-portal.md`
- `docs/data/notices.md`
- `docs/runbooks/ingestion.md`
