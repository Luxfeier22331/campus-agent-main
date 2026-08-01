---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0002
status: accepted
---
# ADR-0002 对象存储

## 背景

采集产物需要持久存储和稳定引用，但运行时合同不能绑定主机路径、单一存储供应商或可变的
对象清单。部署方式、对象命名实现和跨组件传递合同需要各自维护。

## 决策

采集产物通过 S3 兼容接口写入两个逻辑 bucket：

- `campus-agent-source`：采集字节、供应商观测、来源事实和来源任务证据；
- `campus-agent-derived`：确定性转换结果、任务结果和发布产物。

source 与 derived 使用不同凭据。运行时合同传递不依赖 bucket 的 `s3://` 产物引用、
digest 和字节数，不传递主机挂载路径或供应商 SDK 类型。

两个逻辑 bucket 名称是源码合同，S3 client region 固定为兼容值 `us-east-1`。部署环境只提供
endpoint 和消费者所属身份的凭据，不重复配置固定名称与 region。需要隔离本地 worktree 时，只有
对应本地开发入口可以显式覆盖其派生 bucket。

本地开发可以使用本地 MinIO；其中 `campus-rag-derived` 等旧 bucket 只用于读取历史数据，不能作为
staging 或 production 的发布输入。当前 staging 使用环境仓提供的 k3s MinIO `campus-agent-derived`；
其他正式环境也使用环境仓管理的同名 S3 兼容派生桶，不依赖开发机存储。文档发布、Campus Web 构建
和其他派生产物通过同一 derived bucket 消费；不因为文档阅读器再创建一个 bucket，也不把旧的
`public_docs/.../current` 聚合文件复制成新的运行时入口。

MinIO 是可接受的自托管实现，但不是应用合同。替换为其他 S3 兼容服务时，只改变部署
配置和凭据，不改变产物 identity 或运行时 DTO。

对象 key 由可执行 builder 和来源合同维护，不在 ADR 中复制 inventory。key 必须：

- 使用相对、确定且不依赖主机的路径；
- 区分来源 identity 与派生文档 identity；
- 覆盖会丢失执行证据时，保留 retry attempt；
- 不仅依靠路径片段推断必需 metadata。

浏览器不能直接访问这两个 bucket。复用派生对象的产品接口必须通过所属后端读取明确前缀；例如
App API 只通过私有绑定读取 `campus-agent-derived/dining/floorplans/`。地图或媒体若因访问和生命周期
不同改用公开 bucket，也不得因此新增另一套采集 source/derived bucket。

## 后果

- 对象存储不可用时，production 代码不回退到本地文件写入。
- bucket 创建、凭据、endpoint、生命周期和供应商选择属于部署环境。
- 文档阅读器只消费发布清单引用的来源阅读资产和内容寻址 release；旧的可变聚合文件即使仍
  保留在桶中，也不是当前数据源。
- 领域 key 结构放在 builder 和测试附近；通用 builder 当前位于
  `packages/ingest-core`。
- Qdrant vector 和原生 snapshot 不是采集对象存储事实。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/code-organization.md`
- `packages/ingest-core/README.md`
