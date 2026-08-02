# 校园地图资产

本目录保存 App API 随 Worker 版本发布的低频校园底图。GeoJSON 文件名是最终文件字节的
SHA-256；`manifest.json` 是 Campus Web 唯一读取入口。新版本新增摘要文件，不覆盖或立即删除
已经发布的摘要文件。

两个当前资产的 geometry 来自 OpenStreetMap / Overpass API，按 Open Database License 1.0
提供，公开页面必须展示 `© OpenStreetMap contributors`。地点名称、校区归属和公共服务语义由
中央民族大学官方校园地图核对，OSM geometry 不作为名称事实源。

来源：

- OpenStreetMap 许可与署名：<https://www.openstreetmap.org/copyright>
- 中央民族大学校园地图：<https://www.muc.edu.cn/xxgk1/xydt.htm>
- 海淀校区参考图：<https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png>
- 丰台校区参考图：<https://www.muc.edu.cn/__local/D/06/88/ED290FD6FCD89E0B4A6A5D0ADDA_11770E2B_26733.jpg>

这些第三方来源派生数据不属于仓库 Apache-2.0 授权范围，详细边界见根目录
`THIRD_PARTY_NOTICES.md`。
