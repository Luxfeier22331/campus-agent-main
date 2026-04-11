---
doc_type: plan
status: active
created: 2026-04-05
updated: 2026-04-11
---

# Campus Place Finding Foundation

## 文档边界

本文只负责“地点寻找 / place finding”首个前向交付 slice 的实施 handoff。

本文不负责：

- 重写长期导航 / wayfinding 架构
- 宣称路线规划已经进入当前 merged truth
- 冻结某个地图 SDK、底图 provider 或坐标转换库的唯一实现

对应 source of truth：

- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`

## 目标

第一期先交付 `place_lookup` / `place_finding` 最小闭环，让 chatbot 能稳定回答：

- “xx楼在哪里”
- “补卡机在哪里”
- “某个办事点在哪里”
- “某个校门 / 服务点在哪里”

这轮工作完成时，至少做到：

1. 产品可以把自由文本地点问句解析成 canonical place entity。
2. 系统可以返回稳定的地点说明，而不是依赖长文本 RAG 猜测。
3. 高歧义地点默认进入 `needs_clarification`，而不是用 top1 硬猜。
4. 首发交互以文本答案 + location card 为主；point-level map preview 允许可选接入，但不是阻塞项。

## 当前状态

当前已冻结的前提包括：

- 导航是独立 `navigation-specialist` family，不应塞回 `rag-specialist`
- `campus_navigation/place_catalog` 是长期 canonical spatial truth 的一部分
- 第一阶段只做 `place_lookup` / `place_finding`，`route_planning` 后置
- `campus_services/*` 当前仍是 `offline_preparation`，不应为了地点寻找重新打开默认 query-serving

启动前缺口包括：

- repo-owned `place_catalog` source truth
- alias-first 的地点解析执行面
- 面向聊天回答的结构化地点结果 contract
- 受控的点位卡片 / 点位预览 UI

截至 2026-04-11，当前 worktree 已补齐这些缺口：

- `configs/ingestion/campus_navigation/place_catalog` 已提供 repo-owned seed 与 runtime profile
- `packages/navigation-specialist` 已实现 alias-first 的 place resolve / clarification / answer shaping
- `packages/contracts` / `packages/supervisor-core` 已接通 `place_lookup` 与 `navigation-specialist`
- `apps/app-api` 已把 `place_card` 落成 assistant `structuredParts` 并持久化到 `chat.messages.structured_parts_json`
- `apps/public-chat-web` 已提供中文地点卡片渲染

当前仍明确 deferred：

- `route_graph`
- `route_planning`
- entrance selection
- accessibility routing
- “离我最近”这类强依赖当前位置或距离排序的问句

## 已冻结默认值

本轮不再继续作为开放问题：

- capability slice：
  - `place_lookup`
  - `place_finding`
- 首发实体类型：
  - `building`
  - `service_point`
  - `office`
  - `gate`
  - `stop`
- 首发交互：
  - explanation text
  - location card
  - optional point map preview
- 首发真相层：
  - `campus_navigation/place_catalog`
- 明确 deferred：
  - `campus_navigation/route_graph`
  - route planning
  - entrance selection
  - accessibility routing
  - “离我最近”这类强依赖当前位置或距离排序的问句

## 首发数据范围

第一期不追求“全校所有点位一次收全”，而是先做高频问句闭环。

推荐首发范围：

- 主教学楼、办公楼、图书馆、食堂、宿舍区、体育场馆等高频 building
- 补卡机、打印点、办事窗口、缴费点、快递点等高频 `service_point`
- 北门 / 南门等主要 `gate`
- 与校园出行直接相关的少量周边 `stop`

推荐原则：

- 先做高频、低争议、位置稳定的地点
- 先做有明确运营价值的地点，不追求 POI 面的“看起来很全”
- 周边点位只收录与校园出行直接相关的低基数关键点

## 结果形态

首发不返回路线，而是返回受控的地点答案。

### 必需结果

- `completed`
  - 返回 explanation text
  - 返回 canonical place ref
  - 返回 location card
- `needs_clarification`
  - 当别名对应多个楼或多个服务点时触发
- `no_answer`
  - 当 catalog 中没有该地点且没有可信替代时触发
- `error`
  - 执行异常或真相层不可用时触发

### Location Card 最小内容

- display name
- entity type
- campus area / nearby landmark
- short location description
- optional opening note / access note
- optional point geometry
- optional source references

### 首发 UI 姿态

- chat 内文本答案是必需项
- location card 是首发推荐默认项
- point-level map preview 是可选增强项
- 不要求 route line、route card、full-map route interaction

## 波次拆分

### Wave 1：Place Taxonomy And Catalog Contract Freeze

目标：

- 冻结首发 place entity taxonomy
- 冻结 `place_catalog` 的最小字段集合
- 明确哪些数据属于 canonical truth，哪些只是 enrichment

`place_catalog` 首发至少应包含：

- `place_id`
- `entity_type`
- `display_name`
- `aliases`
- `campus_scope`
- `campus_area`
- `location_description`
- `point_geometry`
- `coordinate_reference_system`
- `service_tags`
- `access_notes`
- `source_refs`
- `verification_state`

固定规则：

- alias 必须 institution-scoped
- point geometry 与坐标系必须显式，不允许把 provider payload 当 canonical geometry
- provider IDs、SDK payload、前端 renderer 字段不进入 canonical truth

### Wave 2：Repo-Owned Place Catalog Seed And Source Truth

目标：

- 用 repo-owned 方式建立第一版 `place_catalog`
- 优先覆盖首发高频地点，而不是先做复杂自动化采集

推荐输入优先级：

1. repo-tracked curated seed
2. handbook / service-document 派生 facts
3. official-web 页面或目录中的受控地点事实
4. provider enrichment 仅作补充，不作 canonical truth

这一步的关键不是先接地图，而是先让 catalog 稳定。

最小产物建议：

- canonical place catalog artifact
- alias index artifact
- service tag / entity type lookup artifact
- source provenance / verification report

固定规则：

- 不把 `campus_services` 重新开放成默认 query-serving 来解决地点寻找
- 不把补卡机、办事点等地点问题退回成纯文档 RAG 猜测
- manual curated seed 是可接受的首发策略，不必等 crawler 全自动化

### Wave 3：Navigation Specialist Minimal Place-Lookup Slice

目标：

- 新建或引入 `navigation-specialist` 的最小 place-finding 能力
- 只实现 place resolve / clarification / answer shaping

最小职责：

- intent 识别为 `place_lookup`
- alias resolution
- ambiguity handling
- location card shaping
- `completed` / `needs_clarification` / `no_answer` / `error` 终态输出

明确不做：

- route graph search
- route ranking
- multi-leg guidance
- “最近 / 更近 / 怎么走” 的路径类回答

推荐姿态：

- place resolve 优先走结构化 alias/index，而不是 dense retrieval
- 如需 supporting text，可消费受控 source refs，但不能让 supporting text 反向决定 canonical place truth

### Wave 4：Supervisor / App / UI 接线

目标：

- 把 `place_lookup` 接进当前产品主链路
- 让聊天面可以展示地点答案，不等待完整地图站

建议落点：

- `packages/contracts`
  - 新增导航 / 地点寻找 handoff 与结果 schema
- `packages/supervisor-core`
  - 增加 `place_lookup` intent routing
- `apps/app-api`
  - 保持 canonical request ingress 与 response delivery ownership
- `apps/public-chat-web`
  - 渲染 explanation text + location card
- `apps/protected-panel-web`
  - 如有需要，仅作为内部验收 / 运营查看面，不先扩成操作台

首发 UI 要求：

- 文本答案必须独立可用
- 没有地图 preview 时答案仍然成立
- 如果接入点位预览，也只能渲染单点，不引入 route interaction

### Wave 5：Verification And Rollout Gate

目标：

- 建立 place-finding 的最小可回归验证闭环

至少要有的 case：

- exact building match
- alias building match

## 当前工作树验证结果

截至 2026-04-11，Wave E foundation 的 current worktree verification 已通过：

- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_validation tests.supervisor.test_supervisor_routing tests.specialist.test_navigation_specialist tests.test_workspace_layout`
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/chat-structured-parts.test.ts test/shared-product-bootstrap.contract.test.ts`
- `pnpm --dir apps/public-chat-web exec vitest run test/platform-chat-mappers.test.ts test/platform-chat-message-parts.test.ts test/vendor-chat-message.test.ts`
- `pnpm --dir apps/app-api exec tsc -p tsconfig.json --noEmit`
- `pnpm --dir apps/public-chat-web exec tsc -p tsconfig.json --noEmit`

这意味着当前 worktree 已经完成首发 foundation 所要求的 code truth；后续工作转为 seed 扩面、真实 staging smoke / 人工验收，以及明确后置的路线规划 phase。
- service point match
- gate match
- ambiguous alias -> `needs_clarification`
- unknown place -> `no_answer`
- point preview absent 时文本答案仍完整
- point preview present 时不泄漏 provider-specific payload

建议额外覆盖：

- 同名楼宇 / 同类服务点多候选
- 已下线或暂不可用服务点的受控提示
- restricted place facts 如果未来存在，默认 fail-closed

## 文件与模块建议

### Docs

- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `docs/plans/campus-place-finding-foundation.md`

### Config / Data Plane

- `configs/ingestion/campus_navigation/place_catalog/`
- `packages/ingestion-core/`

### Specialist / Contracts

- `packages/navigation-specialist/`
- `packages/contracts/`
- `packages/supervisor-core/`

### Product Surface

- `apps/app-api/`
- `apps/public-chat-web/`
- `apps/protected-panel-web/`

## 验收标准

完成后以下条件同时成立：

- 首发高频地点范围已形成 repo-owned `place_catalog`
- chatbot 能稳定回答“xx楼在哪里”“补卡机在哪里”这类高频地点问句
- 高歧义地点默认澄清，而不是硬猜
- 首发答案不依赖路线规划也能成立
- 是否接入地图 point preview，不改变地点答案 contract

## 当前不做

本文当前明确延后：

- route graph 建设与路线搜索
- entrance / gate selection 优化
- accessibility routing
- current-location-aware nearest ranking
- full-map browse / route interaction
- 复杂多校园 / 多租户 place federation
