---
doc_type: architecture
owner_boundary: domains/dining
status: active
---
# 食堂

## 边界

Dining 领域维护食堂目录、档口、菜品、参考价格、地图绑定和公开评价。产品行为见
`../../product/dining.md`，数据结构见 `../../data/dining.md`，学生端接口见
`../../contracts/app-api/dining.md`，操作步骤见 `../../runbooks/dining.md`。

## 组件职责

| 组件 | 职责 |
| --- | --- |
| `packages/domains/dining` | 领域模型、数据库 schema、发布校验、开发数据和地图运行时资产 |
| `packages/dining-editor` | 本地平面图编辑与确定性静态 SVG 生成，不进入生产运行时 |
| `jobs/dining-sync` | Feishu/Lark 来源同步、评价审核、附件物化、schema migration 和角色授权 |
| `apps/ops-web` | 草稿校正、校验、发布、回滚和评价治理 |
| `apps/app-api` | 只读当前发布版本与公开评价，提供学生端接口 |
| `apps/campus-web` | 食堂地图、档口、菜品、搜索和评价界面 |

app-api 不提供 Dining 写接口。Ops Web 和同步任务使用各自的数据库角色；Dining 迁移单元创建
`ops_web_dining` 与 `dining_sync`，安装 schema，并一次性应用和验证三类运行权限。Ops Web 核心
安装器不依赖 Dining。

## 目录发布

```text
Feishu/Lark 目录
-> dining-sync 来源观测
-> Ops Web rebase
-> 可编辑草稿与人工修正
-> 校验
-> 不可变 release
-> 当前 publication
-> app-api
-> campus-web
```

来源观测不会自动发布。rebase 从当前有效观测重建草稿，再应用仍有效的人工修正；发布前必须通过
完整领域校验。回滚也创建新的 release，不改变历史 release。

## 评价发布

```text
Feishu/Lark 评价
-> dining-sync 审核与附件物化
-> 评价记录与可见性
-> publication 评价修订号
-> app-api
-> campus-web
```

同步任务保存首次提交内容，后续只更新审核、可见性和精确菜品绑定。图片先写入私有
`campus-dining-media/quarantine/`，审核通过后复制到匿名只读的 `public/`；quarantine 对象一天后
过期。Ops Web 可以隐藏、恢复、重新绑定或请求复审；只有审核通过且绑定完整的评价可以公开。

## 地图边界

地图布局和生成后的 SVG 随 Campus Web 代码版本发布，不属于目录 release，也不进入数据库或
对象存储。`floorplanId` 连接数据库发布内容与应用内静态地图，窗口通过稳定锚点绑定地图区域。

没有正式地图或超出地图锚点容量的档口使用确定性占位布局。地图不可用只影响地图区域，档口、
菜品和评价仍可读取。地图编辑与生成由 `packages/dining-editor/README.md` 维护，运行时资产和锚点
演进由 `packages/domains/dining/README.md` 维护。

## 相关决策

- `../../decisions/adr-0079-dining.md`
