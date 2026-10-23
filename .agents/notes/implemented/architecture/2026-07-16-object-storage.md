# Agent Note: 对象存储

Status: implemented

## 背景

采集产物需要持久存储和稳定引用，但运行时合同不能绑定主机路径、单一存储供应商或可变的
对象清单。部署方式、对象命名实现和跨组件传递合同需要各自维护。

## 决策

采集产物通过 S3 兼容接口写入两个逻辑 bucket：

- `campus-agent-source`：采集字节、供应商观测、来源事实和来源任务证据；
- `campus-agent-derived`：确定性转换结果、任务结果和发布产物。

source 与 derived 使用不同凭据。运行时合同传递不依赖 bucket 的 `s3://` 产物引用、
digest 和字节数，不传递主机挂载路径或供应商 SDK 类型。

集群沿用上述两个 bucket 名称，S3 client region 固定为兼容值 `us-east-1`。部署环境提供
endpoint 和消费者所属身份的凭据。按照[独立本地数据平面](./2026-09-24-independent-worktree-data-plane.md)，
本地初始化通过 `OBJECT_STORE_BUCKET_SOURCE` 与 `OBJECT_STORE_BUCKET_DERIVED` 指定当前 worktree 的
source 与 derived bucket；采集器、publisher 和 reader 必须消费同一 profile 配置。采集器及状态版本操作要求显式配置 source bucket；集群 Job 模板提供部署桶名，代码不提供默认桶。

本地开发使用 RustFS。部署环境使用环境仓管理的同名 S3 兼容派生桶，不依赖开发机存储。
文档发布、Campus Web 构建和其他派生产物通过同一 derived bucket 消费；不因为文档阅读器再创建
一个 bucket，也不把旧的 `public_docs/.../current` 聚合文件复制成新的运行时入口。

自托管实现不是应用合同。源码部署清单使用固定版本的 RustFS；替换 S3 兼容服务时，只改变部署
配置和管理边界，不改变 bucket、应用凭据、产物 identity 或运行时 DTO。实际环境是否完成迁移以
环境仓选择的 Source revision 和部署状态为准，不由本笔记 推断。

对象 key 由可执行 builder 和来源合同维护，不在 ADR 中复制 inventory。key 必须：

- 使用相对、确定且不依赖主机的路径；
- 区分来源 identity 与派生文档 identity；
- 覆盖会丢失执行证据时，保留 retry attempt；
- 不仅依靠路径片段推断必需 metadata。

浏览器不能直接访问这两个 bucket。复用派生对象的产品接口必须通过所属后端读取明确前缀；例如
App API 只通过私有绑定读取 `campus-agent-derived/dining/floorplans/`。地图或媒体若因访问和生命周期
不同改用公开 bucket，也不得因此新增另一套采集 source/derived bucket。

## 未采用方案

- **把主机路径或存储供应商类型放入运行时合同**：直接对接实现较方便，但会把消费者绑定到部署位置
  与供应商，妨碍替换 S3 兼容服务。
- **为阅读器另建派生桶或可变聚合入口**：可以单独组织文档文件，但会复制既有派生存储和版本选择；
  阅读器直接消费明确引用的发布产物。

## 后果

- 对象存储不可用时，production 代码不回退到本地文件写入。
- bucket 创建、凭据、endpoint、生命周期和供应商选择属于部署环境。
- 文档阅读器只消费发布清单引用的来源阅读资产和内容寻址 release；旧的可变聚合文件即使仍
  保留在桶中，也不是当前数据源。
- 领域 key、摘要和不可变写入行为由实际 producer 在所属模块及测试附近维护，不建立无消费者的
  通用 artifact core。
- Qdrant vector 和原生 snapshot 不是采集对象存储事实。

### 生命周期与恢复

对象存储数据按逻辑 owner 管理：来源 owner 负责门户原始对象和 `source.json` 引用关系，Campus Docs
serving 负责 chunk/embedding 内容寻址制品与当前索引发布，Campus Web/Campus Docs 数据面负责仍被公开
来源清单引用的 reader 和补充资产。当前及历史仍被清单引用的对象不得由通用 TTL 删除；未被引用的对象
只能在人工重新计算存活集合并核对后清理。

上述清单保护和人工核对约束针对来源与 reader 发布资产，不是整个 derived bucket 的统一 TTL。
已接受的 Dining 用户投稿需求使用领域自己的可见性、引用和到期事件；规范化照片的自动清理由
Dining 与 App API 所有，不扫描或删除相邻来源资产，规则集中于
[Dining PRD](../../../../docs/product/dining.md)。源码已接入投稿对象适配器与清理，并在现有 derived 写策略
中补充投稿前缀的删除与版本枚举权限；复用既有身份，交付位置见
[对象存储配置](../../../../docs/environment/providers.md#对象存储)。源码配置不证明云端策略已经生效，
仍须验收引用保护和实际版本字节删除。

bucket versioning 只提供对象版本操作能力，不等于独立备份。备份目的地、保留期、RPO/RTO 和恢复演练
由环境 owner 提供；应用仓库不因使用 RustFS 自动声称已有备份。恢复应先写入隔离目标，再按来源摘要、
对象 checksum、当前索引绑定和 Qdrant collection 进行核对。

`internal_portal/notices/_state.json` 是来源 owner 拥有的可变维护边界，不是通知正文历史。该对象允许覆盖写，
但只保留当前版本；来源采集在写入新版本后删除同一 key 的旧版本和删除标记。该清理复用通知采集已有的
PostgreSQL advisory lock，不扩大到 source bucket 的其他对象，也不改变 derived bucket 的内容寻址制品保留。
清理前由环境 owner 执行对象级备份和只读版本盘点；版本删除失败必须使本轮维护失败并保留当前对象，不能静默
忽略。未启用对象版本控制时不执行版本清理。

## 相关文档

- [采集数据面](../../../../docs/architecture/system/data-plane.md)
