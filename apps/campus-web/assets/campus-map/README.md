# 校园地图资产

本目录保存 Campus Web 随 Worker 版本发布的低频校园底图和地点目录。GeoJSON、地点 JSON
文件名是最终文件字节的 SHA-256；`manifest.json` 是唯一读取入口。新版本新增摘要文件，不覆盖
或立即删除已经发布的摘要文件。

源数据位于 `../../data/campus-map`。`queries/` 保存 Overpass 查询，`snapshots/` 保存采集结果。
使用 `pnpm map:snapshot:update -- --campus=fengtai` 或
`pnpm map:snapshot:update -- --campus=haidian` 获取对应校区的快照。成功响应通过基础结构校验后，
命令只原子替换选定快照，不改写 `curated/`、`places.source.json` 或已发布资产。

维护者根据快照和学校官方校园地图人工审阅并更新 `curated/` 与 `places.source.json`。这些经过审阅的
GeoJSON、地点坐标和语义属性是产品事实源；Overpass 快照只提供采集参考，不自动覆盖它们。审阅后使用
`pnpm map:normalize` 在临时目录生成并校验内容寻址资产，先放置新的摘要文件，最后原子替换
`manifest.json`。发布原子边界是 manifest 指针。使用 `pnpm map:validate` 校验来源与 manifest 一致性、
摘要、GeoJSON、校园边界、地点引用和坐标边界。

两个当前资产的 geometry 来自 OpenStreetMap / Overpass API，按 Open Database License 1.0
提供，公开页面必须展示 `© OpenStreetMap contributors`。地点名称、校区归属和公共服务语义由
中央民族大学官方校园地图核对，OSM geometry 不作为名称事实源。

来源：

- OpenStreetMap 许可与署名：<https://www.openstreetmap.org/copyright>
- 中央民族大学校园地图：<https://www.muc.edu.cn/xxgk1/xydt.htm>
- 海淀校区参考图：<https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png>
- 丰台校区参考图：<https://www.muc.edu.cn/__local/D/06/88/ED290FD6FCD89E0B4A6A5D0ADDA_11770E2B_26733.jpg>

这些第三方来源派生数据不属于仓库 Apache-2.0 授权范围，详细边界见
[公开仓库数据策略的第三方来源声明](../../../../docs/policies/public-source-data.md#第三方来源声明)。
