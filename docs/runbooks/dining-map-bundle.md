---
doc_type: runbook
owner_boundary: dining
status: active
---

# 食堂地图 bundle 导入导出

## 目标和边界

本文说明内容维护人员如何在 Ops Web 地图工作台之间迁移已保存的食堂地图草稿。交换文件是完整的
`DiningFloorplanBundleV1` JSON；工作台继续拥有 bundle 校验、revision 并发检查、草稿保存、地图发布和
发布历史。导入不会直接写数据库、重跑 bootstrap 或自动发布。

地图草稿是全局范围。一次导入会整体替换目标工作台的所有校区、食堂和楼层，不提供按食堂合并；操作前
必须核对导入文件内容和目标工作台现有范围。未点击发布并完成发布确认时，学生端当前版本保持不变。

## 导出已保存草稿

1. 打开 Ops Web 的“平面图维护”页面 `/dining`。
2. 保存所有需要保留的画布修改，直到“保存草稿”完成；画布有未保存修改或保存请求进行中时，不能导入或导出。
3. 点击“导出”。浏览器下载 `dining-floorplans.bundle.v1.json`，内容是当前服务端已保存的完整全局草稿。
4. 将 JSON 文件交给目标工作台的维护人员。文件超过 `8 MiB` 时，目标工作台会拒绝导入。

## 导入并替换草稿

1. 在目标 Ops Web 打开 `/dining`，确认当前草稿与待导入文件都属于预期环境。
2. 点击“导入”，选择导出的 JSON 文件。只接受 UTF-8 JSON 和严格符合 `DiningFloorplanBundleV1` 的完整 bundle；
   不接受 SVG、tldraw 文档、未知字段、超限文件或存在地图诊断问题的布局。
3. 在确认框检查食堂、楼层和窗口数量，并确认提示中的全局整份替换范围。缺少的食堂或楼层也会从目标草稿移除。
4. 点击“替换草稿”。工作台复用现有 `PUT /api/ops/dining/draft` 和当前 `expectedRevision` 保存；保存成功后，
   画布按服务端返回的 bundle 重建，状态显示“草稿待发布”。
5. 检查楼层、窗口与其他地图内容。若当前草稿已被其他维护人员更新，revision 检查会拒绝本次保存；刷新目标页面后
   重新确认当前内容，再选择同一文件重试。

导入只保存为草稿。发布历史和学生端当前版本不会因导入改变，工作台不会在导入期间请求发布接口。

## 单独发布

确认草稿内容和窗口引用正确后，使用工作台现有“发布”按钮并再次确认。发布仍由服务端检查菜单及投稿引用的窗口，
生成地图 SVG 并写入对象存储，再创建 release 并切换当前 publication。发布失败时按工作台错误信息修复目标草稿，
不要改用数据库直写、bootstrap 覆盖或临时 Kubernetes Job。

## 相关文档

- [食堂产品需求](../product/dining.md)
- [地图草稿与发布实现](../../apps/ops-web/src/server/dining-store.ts)
- [地图 bundle 合同](../../packages/domains/dining/src/floorplans/bundle.ts)
