# 第三方声明

除非文件或目录另有说明，本仓库使用 Apache License, Version 2.0。

本文记录不自动包含在仓库 Apache-2.0 授权中的来源和署名边界。

## 依赖许可证

根目录 `LICENSE` 和 `NOTICE` 覆盖仓库自有源码、配置、测试和文档。第三方 package dependency
继续使用各自上游作者的许可证。

发布 release artifact 前，必须分别生成并评审 `pnpm`、`uv`、Cargo、Go 和 Maven dependency
license inventory。本文不是完整的机器生成依赖许可证报告。

## 来源数据与 Fixture

仓库包含用于验证 ingestion 和 rendering 行为的来源派生配置、测试、fixture 和 reference
data。这些内容保留原上游所有权和许可证；仓库 Apache-2.0 不会重新授权校园网站页面、
notice、document 或其他第三方内容。

已知类别包括：

- collector test 使用的 synthetic public website snippet 和 HTML fixture；
- ingestion test 使用的 synthetic campus notice、document、curriculum 或 regulation sample；
- map loader code、synthetic map fixture 和项目 self-authored map data。

可公开 source/data 路径边界见 `docs/policies/public-source-data.md`。

## 地图数据

项目 self-authored GeoJSON、tile 与坐标可以按仓库许可证保留。第三方或来源派生地图数据只有在
再分发权利、上游 license 与 attribution 要求明确时才能提交；否则由受控对象存储加载，并让
license 与 attribution metadata 随 release 保存。

## 商标与品牌

Apache-2.0 不授权项目名、组织名、logo 或其他品牌标识的商标使用，但为合理说明作品来源
而进行的通常使用除外。
