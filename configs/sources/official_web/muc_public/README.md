# muc_public 来源配置

`muc_public` 是 Official Web 适配器使用的合成站点配置，网址位于 `example.edu`。它用于验证配置
加载、定向发现、抓取、页面分类、质量检查和来源产物保留，不表示真实学校官网已经接入。

## 配置分工

- 站点、主机和种子文件限制可访问范围；
- 抓取、调度和质量文件控制离线执行；
- source pack、target map 与 inventory 提供有明确目的的抓取清单和页面匹配提示；
- consumer denominator 决定页面作为来源正文保留、仅用于发现还是拒绝；
- projection declarations 提供页面类别的后续离线处理提示。

这些配置只影响 Official Web 来源采集。它们不会创建查询目标、向量索引、文档 release 或模型
工具；当前在线目标仍以 `configs/runtime/query-serving-targets.v1.json` 为准。

具体值只由 JSON 文件维护。整体边界见 `docs/domains/official-web.md`。
