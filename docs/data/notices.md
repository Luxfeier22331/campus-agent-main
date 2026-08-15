---
doc_type: data
owner_boundary: domains/notices
status: active
---
# 通知数据

## 边界

本文统一维护通知来源对象、规范化投影和资源的长期数据语义。HTTP 响应由
`../contracts/app-api/notices.md` 维护，采集和发布步骤由 `../runbooks/ingestion.md` 维护。

来源对象存在只表示采集成功；`notices.*` 记录存在只表示 publisher 已完成规范化写入。两者都不表示
领域处理器、Agent、RAG 或用户已经消费。通知数据不保存采集批次、模型理由、置信度、原始模型响应、
阅读状态、对外发布状态或领域处理状态。

## 来源对象

`source-collector` 的本地通知命令读取门户通知选择器、全局列表和详情，在 source bucket 写入
`internal_portal_notice_source.v2`。选择器返回的类型集合是采集范围；空类型全局列表只提供跨类型
增量顺序，其中不属于选择器范围的条目不会落桶：

```text
internal_portal/notices/<notice-id>.json
```

来源对象保存 `notice_id`、`notice_type`、`organization_id`、原始标题、发布时间、外链标记与 URL、
门户 HTML 正文和附件 metadata。类型和组织名称不在每条通知重复，集中保存在：

```text
internal_portal/meta.json
```

`internal_portal_meta.v1` 保存通知选择器返回的类型与组织名称映射。采集器合并已有映射：当前返回的
同 ID 名称覆盖旧名称，当前未返回的历史 ID 保留。

内部通知固定使用 `is_external=false`、`external_url=null`；门户实际返回 HTTP 或 HTTPS URL 时使用
`is_external=true` 并保留该 URL。采集器不请求外部页面，`notice_content_html` 只表示门户详情接口
返回的正文。已有合法来源对象不再请求详情；当前合同不维护同 ID 内容版本。

同步边界保存在：

```text
internal_portal/notices/_state.json
```

`internal_portal_notice_sync_state.v2` 只记录全局 `head_notice_id`、`history_covered_from` 和更新时间。
`head_notice_id` 可以指向采集范围外的全局列表条目，因此不保证存在同 ID 通知对象。全局列表顺序用于
识别增量，不能根据通知 ID 数值推断新旧。通知对象和 `meta.json` 全部写入成功后才推进状态；增量同步
与历史回填必须串行执行。通知独立、随机消费，不创建 `captures/` 批次。

跨运行时字段和校验规则以 `packages/ingestion-contracts/schemas/` 中登记的 JSON Schema 为可执行来源。

## 来源资源

初次列表与详情采集不下载资源。显式资源命令读取来源对象中的引用，把门户图片和附件原始字节写入：

```text
internal_portal/notices/<notice-id>/images/<ordinal>
internal_portal/notices/<notice-id>/attachments/<ordinal>
```

图片 source ordinal 按来源 HTML 中可采集门户图片的原始顺序计算。编辑器占位图不下载，因此图片 key
可以不连续；publisher 使用 source ordinal 读取正确字节，再为正文占位符和 PostgreSQL 生成连续的
展示 ordinal。附件 ordinal 与来源 metadata 顺序一致。

附件的 `notice_annex_id` 是门户资源身份，`notice_annex_path` 只作为来源 metadata 保留。资源命令按
通知 ID、资源类型和序号 create-or-verify，不改写通知 JSON，也不抓取外部正文。

## 分类交接

`scripts/notices` 只读来源对象和 `meta.json`，把门户正文临时转换为纯文本，并输出一次性
`notice_id/domain` JSONL。每条通知只接受一个内部领域；`unclassified` 用于尚未确认的通知。分类输入
由人员确认后交给 publisher，不写入 source bucket、derived bucket 或 PostgreSQL，也不保存分类模型
metadata。分类完成不表示任何领域处理器已经消费。

## 规范化投影

### PostgreSQL

`notices.notice_types` 和 `notices.organizations` 保存门户 ID 与名称映射，`notices.domains` 保存允许的
内部领域。`notices.notices` 保存通知 ID、类型、可空组织 ID、原始标题、发布时间、外链标记与 URL、
唯一领域以及清洗后的 `content_html`、`content_text`。

`notices.notice_assets` 按通知、资源类型和从零开始的展示序号保存名称、媒体类型、字节数、SHA-256
和附件的 `portal_annex_id`；图片的该字段为空，完整门户下载 URL 不落库。表结构和授权的可执行来源是
`jobs/notice-publisher/migrations/`。

### 正文清洗

正文只接受通知领域包允许的结构化标签。脚本、样式、表单、iframe、class、ID 和事件属性被移除；
无效链接解包为文本，合法链接只允许 HTTP、HTTPS 与 mailto。来源标题、空段落和编辑器占位图不进入
投影，正文标题从 `h3` 开始。

首行缩进、对齐、粗体、下划线、警示色和高亮只转换为共享合同规定的有限属性或语义标签；表格只
保留经过范围校验的合并单元格，并把门户标记的首行转换成表头。门户使用大缩进模拟的尾部落款转换为
右侧对齐，原始 CSS 不进入投影。

来源门户图片改写为 `notice-asset:image:<ordinal>`，并保存清洗后的 `alt`。外链通知的两个正文字段
固定为空，只保留原始标题、来源 metadata 与 `external_url`；门户详情返回的包装 HTML 仍留在来源
对象中。`content_text` 始终从站内通知的最终清洗 DOM 生成。

### Derived 资源

publisher 校验来源资源后，把内容寻址对象写入 derived bucket：

```text
notices/assets/sha256/<digest>
```

source bucket 只由 source-collector 和显式 publisher 使用，不向 Worker 或浏览器开放。App API 当前
只按数据库摘要读取通知图片并通过通知所属的同源接口返回字节；浏览器不接收 bucket key、摘要或对象
存储凭据。附件 metadata 包含门户资源身份，App API 即时构造门户 URL，附件字节继续由门户响应。

对象存储返回 `application/octet-stream` 时，publisher 按已知文件扩展名推导媒体类型；无法识别时
保留不带 charset 的 `application/octet-stream`。

## 所有权

- `source-collector` 只写 source bucket；
- `notice-publisher` 校验来源、写 derived bucket，并以事务写入 `notices.*`；
- App API 只读五张通知业务表和获准图片对象，不读取 migration ledger 或写入通知；
- Campus Web 只通过 App API 读取规范化通知；
- Ops Web 拥有内部门户凭据，execution-control、Agent 与 RAG 不连接通知来源或 schema。

通知 publisher 只作为本地显式写入入口维护，不属于 Kubernetes 或 GitOps 在线拓扑；本地投影结果不表示
任一环境已经选择、写入或开放这套数据。

## 相关文档

- `../architecture/domains/notices.md`
- `../contracts/app-api/notices.md`
- `../runbooks/ingestion.md`
- `../decisions/adr-0087-internal-portal-notice-source.md`
- `../decisions/adr-0088-normalized-notice-storage.md`
