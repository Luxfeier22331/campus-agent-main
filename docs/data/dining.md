---
doc_type: data
owner_boundary: domains/dining
status: active
---

# 食堂数据

## 边界

本文说明 `apps/app-api/src/db/schema/dining.ts` 的逻辑对象和不变量。Drizzle schema、migration
和测试拥有精确字段；本文不复制每个审计列、索引或 HTTP response。

## 所有权

- app-api migration：表结构；
- `packages/domains/dining`：领域类型、release state machine 和 snapshot projection；
- `jobs/dining-sync`：source observation、catalog/review 写入和发布；
- app-api 路由：学生侧和运维侧读取模型；
- 对象存储：通过审核的评价图片；
- 平面图包：SVG 和 manifest，不写入数据库正文。

## 表族

### 目录

| 表 | 用途 |
| --- | --- |
| `dining.halls` | 校区内食堂身份与状态 |
| `dining.floors` | hall 下地图及 floorplan manifest ref |
| `dining.windows` | 地图档口、anchor、geometry、tag 和状态 |
| `dining.stall_profiles` | 经营档口身份 |
| `dining.window_assignments` | Window 与 Stall Profile 的有效期关系 |
| `dining.menu_items` | 菜品身份 |
| `dining.menu_offerings` | Assignment 下菜品和价格文本 |

关键不变量：

- floor 必须引用已登记 hall 和 floorplan manifest；
- `svg_anchor_id` 必须存在于对应 manifest，placeholder floor 使用受控 geometry；
- active assignment 的有效窗口不能产生无法解释的重叠；
- offering 必须同时引用有效 assignment 和 menu item；
- `price_label` 可以为空，任何层都不得合成占位价格。

### Source 与 Review

| 表 | 用途 |
| --- | --- |
| `dining.source_observations` | 飞书 catalog/review 的受控 observation、hash 和 freshness |
| `dining.source_sync_runs` | 一次同步的有界计数与终态 |
| `dining.review_projections` | 已审核、已绑定当前 catalog 的学生评价 |

`source_observations` 保存受控 payload，不保存 credential。相同来源记录采用稳定 identity 和
content hash upsert，本轮未出现的旧记录标记 stale，不静默删除。

review projection 必须包含已发布的 hall、stall profile 和 window identity。无法解析关系、
审核失败或附件未物化的记录不能进入学生 projection。图片 URL 必须是稳定本地静态 URL，不得包含
飞书 token 或临时下载地址。

### Draft 与发布

| 表 | 用途 |
| --- | --- |
| `dining.draft_versions` | 运维编辑后的版本摘要 |
| `dining.release_candidates` | 冻结候选 snapshot、hash、状态和发布方式 |
| `dining.release_candidate_validation_reports` | blocker、warning 和摘要 |
| `dining.release_schedule_jobs` | 已批准 candidate 的定时发布任务 |
| `dining.releases` | 不可变发布记录 |
| `dining.release_snapshots` | 学生端完整 published read model |
| `dining.release_latest_pointer` | 当前 release 指针 |
| `dining.audit_events` | 受控变更审计 |

发布不变量：

- candidate snapshot hash 在创建后不可变；
- approve 前必须存在通过的 validation report；
- publish 校验 expected predecessor；
- release、snapshot、latest pointer 和 audit 原子提交；
- rollback 把 latest pointer 切回已知 release 和 snapshot，不修改旧 release；
- scheduler 不能发布未批准、已取消或 predecessor 漂移的 candidate；
- audit 只保存受控 before/after 摘要，不保存 secret 或 raw provider payload。

## 已发布读取模型

student route 只读取 `release_latest_pointer -> release_snapshots`。snapshot 至少冻结：

- hall/floor 选择信息；
- 平面图 ID、SHA-256、资产 URL 和锚点清单；
- Window、Assignment、Stall Profile、Menu Offering；
- tag filter 和 source 更新时间；
- 与当前 catalog 一致的 review projection 引用。

没有 latest pointer 不表示可以读取 draft；halls 返回空，具体 floor 按 HTTP 合同失败。

## 来源初始化

生产 catalog 由 `jobs/dining-sync` 从飞书 observation 发布。repo dev seed 只允许在非生产环境
显式导入，用于验证本仓库 floorplan 和 UI；app-api 启动不自动导入，也不在发布缺失时 fallback。

## 对象存储

当前只保存通过审核的 review image 及临时 moderation object。数据库保存稳定 public URL 和必要
metadata，不保存 raw attachment、file token、bucket credential 或管理路径。

## 验证与操作

- 精确 schema：`apps/app-api/src/db/schema/dining.ts`
- 领域不变量：`packages/domains/dining/test`
- 同步/发布：`jobs/dining-sync/test`
- 操作步骤：`../runbooks/dining.md`
- HTTP：`../contracts/app-api/dining.md`、`../contracts/app-api/dining-ops.md`
