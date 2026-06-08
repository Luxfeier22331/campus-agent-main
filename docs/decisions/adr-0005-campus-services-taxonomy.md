---
doc_type: decision
decision_id: ADR-0005
status: accepted
created: 2026-03-24
updated: 2026-03-27
---
# ADR-0005 校园服务类语料 taxonomy

适用范围：`campus-agent` v2 第一阶段后的 taxonomy 收口与后续离线服务语料接入

## 结论

- 新增长期知识域 `campus_services`
- 首批 collection 固定为：
  - `service_catalog`
  - `contact_directory`
- `中央民族大学校内常用电话` 不再属于 `regulations/student_rules` 的逻辑文档真相
- handbook 电话页后续作为 `campus_services/contact_directory` 的派生输入，而不是继续留在
  `regulations` 查询面
- 历史原型中的 `service_portal` 只作为迁移输入与历史来源参考，不作为
  `campus-agent` 的长期 corpus 名

## 原因

- `corpus` 在本仓库里表示长期知识域，而不是来源站点或原始文件夹
- 电话目录与服务入口同属校园服务发现语料，但与规章问答的查询面、字段形状和后续 agent 语义不同
- raw/source artifact 已经是 corpus-agnostic；问题只在 document-level 投影和默认查询面
- 继续把电话目录留在 `regulations` 会让规章查询面和服务导航查询面长期混杂

## 具体边界

### `service_catalog`

用于承接：

- 一网通办事项详情页
- 服务专题页
- 办事入口与目录页
- 其他导航导向的服务发现内容

### `contact_directory`

用于承接：

- 校内常用电话
- 部门联系电话
- 未来新增的联系人目录或联系方式汇总

## 当前阶段约束

- 两个 collection 当前都只进入 offline data-plane，不开放 retrieval 或默认 query-serving
- 不在本轮把历史原型 canonical 目录直接当成运行时真相
- 不在本轮实现新的 retrieval 路由、agent 暴露或 query-serving 开关

## 对现有 handbook truth 的影响

- `configs/ingestion/regulations/student_rules/split-manifest.v1.json` 移除
  `中央民族大学校内常用电话`
- handbook cleanup 中的电话表结构化逻辑保留，作为未来 `contact_directory` 派生处理的实现基础
- `student_rules` 继续表示规章导向的 handbook 逻辑文档集合，而不是整本手册中所有页面的无差别投影
- handbook 到 `campus_services` 的 projection 选择器不再要求保留旧 `regulations`
  document_id； 对已从 split manifest 移出的页段，应由 source-truth selector `source_title +
  source_handbook_section + source_page_start/source_page_end` 直接声明
