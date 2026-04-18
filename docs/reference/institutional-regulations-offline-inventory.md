---
doc_type: reference
status: active
created: 2026-04-14
updated: 2026-04-19
---

# Institutional Regulations Offline Inventory

## 文档边界

本文冻结当前 repo 已采集 regulation corpus 的离线 inventory。

它回答的是：

- 目前有哪些已采集 notice family 可直接作为 regulation 消费
- 哪些仍是 source hold / auth-blocked
- 哪些虽然已采集，但不属于当前 `regulations/institutional_regulations` 导入线

它不回答：

- 新一轮 portal 采集
- OCR/provider 细节
- chunking 规则设计
- embedding / Qdrant / release

machine-readable 对应文件：

- [regulation-offline-inventory.json](/home/reptilian/code/campus-agent/.planning/quick/260414-ang-regulation-corpus-inventory-blocked-fron/regulation-offline-inventory.json)

## 当前 formal local current target

自 2026-04-19 起，当前 repo 真相已明确把 `annual_cycle_rule` / `time_bound_operational_rule` 从 `regulations/institutional_regulations` 中移出，统一下沉到 `regulations/scoped_rules` holding collection。

因此，当前 captured corpus 中仍应视为 `regulations/institutional_regulations` formal local current target 的，只剩 institution-wide stable regulation：

- `中央民族大学采购工作管理办法`
- `中央民族大学关于学生使用人工智能的指导意见 / 2026版`

`355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知` 当前已不再是 isolated sample：

- 当前语义：attachment owner recovered 并已 formal current-target materialized
- 当前状态：`accepted_current_target`
- 当前 owner kind：`attachment_document`

## 当前已转入 `scoped_rules` holding 的 captured items

以下已采集 title 虽然仍属于 regulation downstream consumption，但当前 target 已改为 `regulations/scoped_rules`，而不是 `regulations/institutional_regulations`：

- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `药学院2021年硕博连读博士研究生招生实施细则`
- `历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `中央民族大学丰台校区就医管理办法（暂行）`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

## 当前 source hold / blocked frontier

### Duplicate Hold

- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
  - 当前状态：`duplicate_hold_source`
  - 对应 primary：`191176`

### Auth-Blocked

- `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
  - 当前状态：`auth_blocked_file_release_owner_missing`
  - 缺口：
    - next auth window 的 bounded `file_release` capture
    - 以及真正的 `file_release -> owner body recovery`

## 当前不属于 regulation target 的 follow-up

- `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
  - 当前状态：`handbook_follow_up_not_regulation`
- `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
  - 当前状态：`handbook_follow_up_not_regulation`
- `177880 / 关于印发实施《中央民族大学学生申诉管理办法》的通知`
  - 当前状态：`wrapper_follow_up_not_in_current_target`

## 当前可做的离线工作

在没有认证态的前提下，当前只建议围绕这份 inventory 做：

- 继续消费已进入 formal local current target 的 institution-wide regulation
- 继续消费已转入 `regulations/scoped_rules` 的 annual/time-bound scoped rules，但不要把它们重新写回 `institutional_regulations`
- 保持 `355282` 作为 attachment-backed regulation current truth，不再回退成 isolated sample
- 保持 `351119` 为 auth-blocked frontier，不再误推进
- 保持 `351699 / 351704 / 177880` 不进入当前 regulation target
