---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0002
status: accepted
---
# ADR-0002 对象存储

## 背景

采集产物需要持久存储，但运行时合同不能绑定主机路径或单一存储供应商。旧决策把这条
边界与 MinIO 部署指南、对象 key 清单混在了一起。

## 决策

采集产物通过 S3 兼容接口写入两个逻辑 bucket：

- `campus-agent-source`：采集字节、供应商观测、来源事实和来源任务证据；
- `campus-agent-derived`：确定性转换结果、任务结果和发布产物。

source 与 derived 使用不同凭据。运行时合同传递不依赖 bucket 的 `s3://` 产物引用、
digest 和字节数，不传递主机挂载路径或供应商 SDK 类型。

MinIO 是可接受的自托管实现，但不是应用合同。替换为其他 S3 兼容服务时，只改变部署
配置和凭据，不改变产物 identity 或运行时 DTO。

对象 key 由可执行 builder 和来源合同维护，不在 ADR 中复制 inventory。key 必须：

- 使用相对、确定且不依赖主机的路径；
- 区分来源 identity 与派生文档 identity；
- 覆盖会丢失执行证据时，保留 retry attempt；
- 不仅依靠路径片段推断必需 metadata。

面向业务公开交付的存储不属于这两个采集 bucket。地图或媒体可以因访问和生命周期不同
使用公开 bucket，但不得因此新增另一套采集 source/derived bucket。

## 后果

- 对象存储不可用时，production 代码不回退到本地文件写入。
- bucket 创建、凭据、生命周期和供应商选择属于部署环境。
- 领域 key 结构放在 builder 和测试附近；通用 builder 当前位于
  `packages/ingest-core`。
- Qdrant vector 和原生 snapshot 不是采集对象存储事实。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/code-organization.md`
- `packages/ingest-core/README.md`
