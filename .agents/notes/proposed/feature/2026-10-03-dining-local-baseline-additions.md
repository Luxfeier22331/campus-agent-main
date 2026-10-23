# Agent Note: 补充食堂与楼层地图 bootstrap 数据

Status: proposed

## 背景

当前 Dining 地图以一个完整的 `DiningFloorplanBundleV1` 保存：`halls` 描述食堂，`layouts` 描述楼层及其入口、区域、结构、窗口和地标。数据库只有一份全局 `map_draft`，公开端只读取发布版本；仓库中的 [`bootstrap-floorplans.v1.json`](../../../../packages/domains/dining/src/floorplans/bootstrap-floorplans.v1.json) 是空环境初始化输入，产品数据 seed 也从同一个 bundle 生成本地数据。

本次需求是把确定的一批食堂和楼层信息补充到 bootstrap bundle，使后续本地初始化包含这些数据。变更只修改仓库基线文件，不新增 HTTP 接口、数据库表、权限或地图存储机制。既有领域校验、seed 生成和发布流程继续作为验证路径。

## 提案

### 1. 数据输入边界

当前完整的 hall/floor/window 清单不存在于仓库，需要由需求方在实施前提供并确认；它是本计划的数据输入来源，不由代码命名或现有示例推测。清单至少包括每个食堂的 `campus`、`hallId`、名称，每个楼层的 `floorId`、`floorplanId`、名称和所属 hall，以及窗口的稳定 anchor ID、名称、位置、尺寸和必要的入口、区域、结构、地标坐标。已有食堂和楼层保持原 ID，新增记录使用不重复的 ID。

### 2. 修改 bootstrap bundle

在 `packages/domains/dining/src/floorplans/bootstrap-floorplans.v1.json` 中追加经确认的 `halls` 和 `layouts`，保持 `kind`、`schemaVersion`、字段集合和 canonical JSON 顺序不变。能直接使用的楼层图沿用现有结构；没有图形细节的楼层使用 `createDefaultDiningWayfindingLayout` 生成合法的初始轮廓，再由已确认的窗口和入口信息补充。

不新增 HTTP 路由、数据库表或 Ops Web 页面。

### 3. 验证边界

通过既有测试和必要的断言同步覆盖：

1. JSON 与 canonical serialization 一致；
2. 新增 hall、floor 和 floorplan ID 唯一，所有 layout 引用已存在的 hall；
3. 每个 hall 至少有一个 layout；
4. 产品 seed 能从新 bundle 生成 draft、release 和 publication；
5. 所有新增 layout 都能生成 SVG，且发布资源的 fingerprint 与 bundle 一致。

追加数据后必须同步更新当前仓库中针对旧基线数量的断言和描述：

- `packages/domains/dining/test/floorplan-bundle.test.ts` 的 hall 数量 3、layout 数量 5；
- `packages/domains/dining/test/floorplan-contract.test.ts` 的两个 layout 数量 5 断言及相关“all five”描述；
- `packages/domains/dining/test/map-publisher.test.ts` 的 assets 数量 5、hall 数量 3、floor 数量 5、窗口总数 41 断言。

这些是当前基线的固定数量合同，不能把它们当作只验证关系的动态测试。相对地，
`apps/ops-web/test/dining-bootstrap.node.test.ts` 通过
`diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS)` 动态推导基线指纹，
不会因为 bundle 数量变化而需要替换固定 fingerprint；仍需运行它确认 draft、release 和 publication
继续消费同一份 bundle。

不新增验证机制或持久化检查记录。

## 未采用方案

- **新增“创建食堂/创建楼层”维护接口和页面**：本次只是补充 bootstrap 基线数据，没有长期运营需求；新增接口会扩大权限、并发和发布边界，不能由当前需求证明。
- **直接修改本地数据库而不更新仓库基线**：会造成下次初始化和当前环境不一致，其他开发者无法复现。
- **单独复制一份地图 JSON 或新增临时 fixture**：会产生多个事实源；领域 bootstrap、产品 seed 和测试应继续消费同一份 canonical bundle。

## 可观察结果

实施完成后：

- `bootstrap-floorplans.v1.json` 包含新增食堂和楼层，与 canonical serialization 一致；
- 新增数据通过既有领域校验和 seed 测试；
- 运行 `dev:init` 后本地环境包含新增地图内容。

## 风险

- 需求方未提供完整食堂、楼层、窗口和坐标清单时，实施应停留在本提案阶段。
- 新增窗口若没有对应菜单或投稿属于合法空内容；修改既有窗口 ID 会破坏菜单、投稿和发布保护，本次只允许新增或保留原 ID。
