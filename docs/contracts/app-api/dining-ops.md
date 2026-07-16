---
doc_type: contract
owner_boundary: apps/app-api
status: active
---
# App API 食堂运维 HTTP 合同

## 文档边界

本文定义 `apps/app-api` 的食堂运维 HTTP 合同。

这些接口已在 app-api 注册为 `operator-via-panel` 路由，但当前
`apps/operator-console-web` 明确拒绝 `/api/ops/dining/*`，也没有食堂运维页面。因此本文只
定义服务端合同，不表示当前存在浏览器消费面。

它补充：

- `docs/contracts/app-api/operator-ops.md`
- `docs/data/dining.md`
- `docs/architecture/domains/dining/architecture.md`

当前合同采用发布候选生命周期。接口不得直接发布可变的当前草稿。

## 已注册接口

```http
GET    /api/ops/dining/halls
GET    /api/ops/dining/halls/:hallId/floors/:floorId
PATCH  /api/ops/dining/windows/:windowId
POST   /api/ops/dining/window-assignments
PATCH  /api/ops/dining/window-assignments/:assignmentId
POST   /api/ops/dining/menu-items
PATCH  /api/ops/dining/menu-items/:menuItemId
POST   /api/ops/dining/menu-offerings
PATCH  /api/ops/dining/menu-offerings/:offeringId
GET    /api/ops/dining/release-candidates
POST   /api/ops/dining/release-candidates
GET    /api/ops/dining/release-candidates/:candidateId
POST   /api/ops/dining/release-candidates/:candidateId/validate
POST   /api/ops/dining/release-candidates/:candidateId/approve
POST   /api/ops/dining/release-candidates/:candidateId/schedule
POST   /api/ops/dining/release-candidates/:candidateId/publish
POST   /api/ops/dining/release-candidates/:candidateId/cancel
GET    /api/ops/dining/releases
GET    /api/ops/dining/releases/:releaseId
POST   /api/ops/dining/releases/:releaseId/rollback
GET    /api/ops/dining/audit-events
```

## 对象模型

## 平面图引用

Dining floorplan owner、anchor、manifest lifecycle 和 technology choices 见
`docs/architecture/domains/dining/architecture.md`。本文只冻结 ops HTTP fields and
route behavior.

### 食堂

```json
{
  "campus": "海淀校区",
  "floors": [
    {
      "floorId": "haidian-canteen-1-1f",
      "label": "一层",
      "floorplanId": "floorplan:haidian-canteen-1:1f",
      "svgAssetUrl": "/assets/dining/haidian-canteen-1-1f.svg"
    }
  ],
  "hallId": "haidian-canteen-1",
  "name": "海淀一食堂",
  "status": "active"
}
```

### 窗口

```json
{
  "floorId": "haidian-canteen-1-1f",
  "hallId": "haidian-canteen-1",
  "label": "热餐窗口",
  "locationLabel": "入口左侧",
  "svgAnchorId": "window-01",
  "status": "active",
  "tags": ["热餐"],
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

`svgAnchorId` 将食堂窗口绑定到已清理的 SVG 锚点，不属于导航路网事实。

### 窗口分配

```json
{
  "assignmentId": "assignment:haidian-canteen-1:haidian-canteen-1-1f:haidian-canteen-1:haidian-canteen-1-1f:window-01",
  "stallProfileId": "stall:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "status": "active",
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

### 档口资料

```json
{
  "displayName": "盖饭窗口",
  "stallProfileId": "stall:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "stallType": "food_window",
  "status": "active",
  "tags": ["主食"]
}
```

### 菜品

```json
{
  "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "name": "盖饭",
  "status": "active",
  "tags": ["主食"]
}
```

### 菜品供应

```json
{
  "assignmentId": "assignment:haidian-canteen-1:haidian-canteen-1-1f:haidian-canteen-1:haidian-canteen-1-1f:window-01",
  "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "offeringId": "offering:assignment:...:menu:...",
  "priceLabel": "12-18 元"
}
```

## 读取接口

### `GET /api/ops/dining/halls`

返回：

```json
{
  "halls": []
}
```

### `GET /api/ops/dining/halls/:hallId/floors/:floorId`

返回 floor draft：

```json
{
  "assignments": [],
  "floor": {
    "floorId": "haidian-canteen-1-1f",
    "hallId": "haidian-canteen-1",
    "label": "海淀一食堂一层",
    "draftVersionId": "dining_draft_version:42",
    "floorplan": {
      "anchorInventory": [
        {
          "anchorId": "window-01",
          "label": "一号窗口",
          "role": "window"
        }
      ],
      "floorId": "haidian-canteen-1-1f",
      "floorplanId": "floorplan:haidian-canteen-1:haidian-canteen-1-1f",
      "hallId": "haidian-canteen-1",
      "sha256": "sha256:...",
      "svgAssetUrl": "/assets/dining/haidian-canteen-1-haidian-canteen-1-1f.svg"
    },
    "svgAssetUrl": "/assets/dining/haidian-canteen-1-haidian-canteen-1-1f.svg"
  },
  "menuItems": [],
  "menuOfferings": [],
  "stallProfiles": [],
  "windows": []
}
```

规则：

- 这是 draft read，不是 student published projection
- student-facing `/api/dining/*` 不能读取本 route
- ops response 只返回 repo floorplan manifest metadata，不返回 SVG markup、
  object storage bucket/key 或上传资产字段；Operator Console 通过
  `@campus-agent/dining/floorplans` package 渲染同一份 floorplan manifest
- 平面图变更随应用发布，不通过运维 HTTP 命令修改

## 写入接口

### `PATCH /api/ops/dining/windows/:windowId`

请求：

```json
{
  "label": "南侧热餐窗口",
  "locationLabel": "南侧 01",
  "svgAnchorId": "window-01",
  "status": "maintenance",
  "tags": ["热餐", "维护中"]
}
```

返回：

```json
{
  "window": {}
}
```

### `POST /api/ops/dining/window-assignments`

请求：

```json
{
  "stallProfile": {
    "displayName": "新风味窗口",
    "stallType": "hot_meal",
    "tags": ["热餐"]
  },
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

返回 `201`：

```json
{
  "assignment": {},
  "stallProfile": {}
}
```

### `PATCH /api/ops/dining/window-assignments/:assignmentId`

请求：

```json
{
  "stallProfile": {
    "displayName": "南侧风味档口",
    "stallType": "hot_meal",
    "tags": ["热餐"]
  }
}
```

返回：

```json
{
  "assignment": {},
  "stallProfile": {}
}
```

### `POST /api/ops/dining/menu-items`

请求：

```json
{
  "name": "番茄牛腩饭",
  "tags": ["主食"]
}
```

返回 `201`：

```json
{
  "menuItem": {}
}
```

### `PATCH /api/ops/dining/menu-items/:menuItemId`

请求：

```json
{
  "name": "香菇鸡腿饭",
  "tags": ["主食", "热餐"]
}
```

返回：

```json
{
  "menuItem": {}
}
```

### `POST /api/ops/dining/menu-offerings`

请求：

```json
{
  "assignmentId": "assignment:...",
  "menuItemId": "menu:...",
  "priceLabel": "18 元"
}
```

返回 `201`：

```json
{
  "offering": {}
}
```

### `PATCH /api/ops/dining/menu-offerings/:offeringId`

请求：

```json
{
  "priceLabel": "16 元"
}
```

返回：

```json
{
  "offering": {}
}
```

## 发布候选接口

发布候选接口是已接受的发布生命周期，不直接发布可变的当前草稿。

### `GET /api/ops/dining/release-candidates`

返回：

```json
{
  "candidates": []
}
```

### `POST /api/ops/dining/release-candidates`

从当前 draft version 创建 candidate，并冻结 candidate snapshot refs。

请求：

```json
{
  "notes": "发布一食堂窗口菜品"
}
```

返回 `201`：

```json
{
  "candidate": {
    "baseDraftVersionId": "dining_draft_version:42",
    "candidateId": "dining_release_candidate:...",
    "createdAt": "2026-06-11T00:00:00.000Z",
    "createdBy": "operator_01",
    "notes": "发布一食堂窗口菜品",
    "publishMode": "manual",
    "scheduledAt": null,
    "snapshotHash": "sha256:...",
    "status": "candidate"
  },
  "validationReport": null
}
```

### `GET /api/ops/dining/release-candidates/:candidateId`

返回 candidate detail、validation report、frozen floorplan manifest refs、diff summary。

### `POST /api/ops/dining/release-candidates/:candidateId/validate`

重新生成 validation report。

返回：

```json
{
  "candidate": {
    "candidateId": "dining_release_candidate:...",
    "status": "validated"
  },
  "validationReport": {
    "blockers": [],
    "status": "pass",
    "warnings": []
  }
}
```

阻塞项示例：

- `missing_floorplan_manifest`
- `floorplan_manifest_checksum_mismatch`
- `missing_svg_anchor`
- `duplicate_svg_anchor_binding`
- `unbound_required_window`
- `missing_stall_profile_projection`
- `missing_menu_item_projection`
- `stale_release_candidate`

### `POST /api/ops/dining/release-candidates/:candidateId/approve`

审批 blocker-free candidate。

请求：

```json
{
  "notes": "确认发布"
}
```

### `POST /api/ops/dining/release-candidates/:candidateId/schedule`

为 approved candidate 设置定时发布。

请求：

```json
{
  "scheduledAt": "2026-06-12T00:00:00.000Z"
}
```

规则：

- 只有已批准的候选可以定时发布；
- 调度器必须在发布前重新校验；
- 调度器不得发布可变的当前草稿。

### `POST /api/ops/dining/release-candidates/:candidateId/publish`

发布 approved candidate，写 immutable snapshot，更新 latest pointer，并写 audit event。

返回：

```json
{
  "release": {
    "candidateId": "dining_release_candidate:...",
    "publishedAt": "2026-06-11T00:00:00.000Z",
    "publishedBy": "operator_01",
    "releaseId": "dining_release:...",
    "snapshotHash": "sha256:...",
    "status": "published"
  },
  "snapshot": {}
}
```

规则：

- 发布必须全部成功或全部失败；
- 校验阻塞项、过期候选、缺少平面图 manifest 或校验和不匹配时失败关闭；
- 发布时把候选中的平面图 manifest 引用冻结到快照；
- 失败时不得更新最新发布指针。

### `POST /api/ops/dining/release-candidates/:candidateId/cancel`

取消尚未 published 的 candidate。Cancelled candidate 保留审计记录，不能再次发布。

## 已发布版本接口

### `GET /api/ops/dining/releases`

返回：

```json
{
  "releases": []
}
```

### `GET /api/ops/dining/releases/:releaseId`

返回 published release metadata、immutable snapshot summary 和 floorplan manifest refs。

### `POST /api/ops/dining/releases/:releaseId/rollback`

把 latest pointer 切回指定的既有 published release 和 snapshot，不创建新 release，也不回写
mutable draft。

请求：

```json
{
  "mode": "latest_pointer",
  "notes": "回滚到上一版"
}
```

规则：

- 回滚必须写入审计事件；
- 回滚不得合成快照载荷；
- 回滚不得读取草稿表重建历史投影；
- 回滚失败时不得修改最新发布指针。

## 审计接口

### `GET /api/ops/dining/audit-events`

按时间倒序返回 `{ "events": [] }`。事件只包含受控操作摘要，不包含供应商原始记录、凭据、
附件内容或对象存储路径。
