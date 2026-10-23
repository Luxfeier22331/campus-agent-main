---
doc_type: domain
owner_boundary: campus-groups
status: active
---

# 同好群

## 目的

为学生提供校园同好群目录。目录展示已核实录入的群信息和已有加入方式，不推断群是否活跃或
失效。

## 数据与维护

- `app-api` 拥有 `campus_groups.sections` 和 `campus_groups.groups`；分组和群分别按
  `position` 排序，群通过 `section_id` 归属分组；
- 数据库初始化目录包含 `ACGN`、`线上游戏` 和 `同好群` 3 个分组，共 55 个条目；
- `ops-web` 通过 app-api 内部接口读取和替换完整目录，不直连这些表；页面支持分组增删、
  重命名和排序，也支持群的维护、组内排序与跨组移动；
- 修改立即进入学生读取的目录，不存在草稿、发布、版本历史或回滚；
- 初始化后不再读取或同步 Wiki，页面和合同不保存来源 URL、修订号或导入状态；
- QQ 头像 URL 由学生端根据群号生成，不写入数据库；Discord 使用页面提供的官方邀请链接；
- MUCWiki 当前目录之外的新群必须先核实名称和联系方式，再通过 Ops Web 录入。学校官网只列出
  组织名称、未提供群号或邀请链接的内容，不作为可加入群写入目录。

## 合同

`packages/contracts/src/campus-groups.ts` 定义有序分组、群条目和公开目录。分组顺序及每个分组
中的群顺序就是学生端展示顺序，不再从群条目字段推断分组。app-api、ops-web 和 campus-web 直接
消费该模块；公开 JSON Schema 生成到
`packages/contracts/schemas/campus-groups-catalog.v1.schema.json`，不得手工修改。

合同只接受 QQ 或 Discord 官方 HTTPS 加入链接，并拒绝重复分组 ID、分组名称、群 ID 和 QQ
群号。没有公开联系方式的条目使用空群号和空加入链接，不伪造联系方式。

## 接口

学生端读取：

```text
GET /api/campus-groups/catalog
```

Ops Web 同源接口：

```text
GET /api/ops/groups/catalog
PUT /api/ops/groups/catalog
```

公开读取与 Ops Web 响应都使用 `Cache-Control: no-store`，Campus Web 不对该路径使用 edge
cache。`PUT` 接收并持久化完整目录，成功响应返回数据库确认后的目录。Ops Web 服务端使用
app-api 管理凭据调用内部接口，浏览器不接触该凭据。

## 非目标

- 从 MUCWiki 或其他页面抓取、解析或同步目录；
- 为目录维护草稿、发布说明、不可变版本、操作记录或回滚状态；
- 根据说明文字判断群是否有效；
- 将同好群注册为模型工具。
