# Agent Note: 正式版本与环境选择

Status: implemented

## 背景

增量候选发布只更新受影响组件，Source SHA 不等于环境全部制品的 producer SHA。#512 要求将已验证
组合确认为正式版本，供历史选择和 GHCR 保留使用。原有最近若干 SHA 与年龄窗口不能表达这一用途。

## 决策

Source 入口复用 GitOps owner 从精确成功 Deployment 导出完整组合，上传 `release.json` 后发布
GitHub Immutable Release；tag 绑定 Source SHA，机器读取锁定的 asset。手动指定统一 0.x 版本，
不改各 package 版本、不重新构建、不把可编辑的 release notes 当合同。

GitOps 选择生成普通评审 PR，只更新应用选择字段；保留平台配置和当前 schema owner，避免旧 schema
程序不认识已应用迁移。现有合同、migration 与 Temporal history 兼容性由维护者结合 diff 评审，
不以版本号推断。暂停自动合并与在途合并共用串行组，恢复时关闭旧滚动提案并重新计算 Source diff。

Cloudflare 只选择仍可部署的原生版本，不长期维护 Worker 构建包。Temporal Worker Versioning 不在
范围内。退役只记录版本及原因；保留根是未退役正式版本与环境/部署恢复引用的并集，包含 OCI 子
manifest，全量删除继续由 #511 Work B 拥有。

full GHCR 入口拆为只读项目报告与现有 PR cache 写清理；项目报告不执行删除。

本篇部分取代[原 GHCR 保留决策](./2026-09-04-ghcr-retention.md)中的 SHA 窗口；
[PR 缓存直查](./2026-09-17-ghcr-pr-cache-direct-cleanup.md)的 PR 清理和暂停全量删除继续有效。

## 未采用方案

- 以单次 candidate artifact 当正式版本：现有产物易复用，但只有增量且短期保留，不能描述完整环境。
- 长期保存并重传 Worker 包：可以越过平台历史窗口，但用户明确选择只使用 Cloudflare 原生回滚。
- 恢复整个历史 GitOps 树：容易得到过去状态，但会同时撤销 Secret、平台和 schema owner，不适合应用回退。
- 新增兼容矩阵或 Temporal Worker Versioning：能承载独立部署策略，但仓库版本没有该职责，不在本次范围。

## 后果

正式发布、环境选择和实际部署继续是不同事实。原生 Worker 过期或绑定资源不兼容时不能保证历史
版本可部署；数据库迁移和 Temporal history 不会随镜像回退。选择 PR 必须审查这些现有合同。
首次正式发布依赖 GitHub immutability 设置、现有 App 的 Source administration read 与跨仓操作权限，
以及 GitOps 对 package 的读取授权。settings 查询不能使用没有 administration 权限的 GITHUB_TOKEN。
本地检查不能替代正式发布、允许的回滚和实际用户路径验收；运行结果归属 Release/Deployment。
