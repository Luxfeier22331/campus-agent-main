# Agent Note: 钉住 rolldown 1.2.3 限制 docs 构建内存

Status: implemented

## 背景

[#473](https://github.com/MUC-WIKI/campus-agent/pull/473) 把 vite 8.2.1 升到 8.3.0（rolldown 1.2.3→1.2.8）后，staging-candidate-publish 的 Campus Web docs 构建（374 个 HTML 入口）在自托管 runner（systemd MemoryMax=2G）连续 OOM。同一份 docs 内容、同一配置的本地 A/B 实测峰值 RSS：vite 8.2.1/rolldown 1.2.3 约 1.11GB，vite 8.3.0/rolldown 1.2.8 约 3.47GB（约 3.1 倍）。上游多 HTML 入口内存问题见 [rolldown#9330](https://github.com/rolldown/rolldown/issues/9330)，finalization 内存修复 [#10554](https://github.com/rolldown/rolldown/pull/10554) 已含在 1.2.8 中但未回到 1.2.3 的水平。

## 决策

[pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) overrides 钉 `rolldown: 1.2.3`，vite 保持 8.3.0。

## 未采用方案

- docs 构建分批多次 `vite build`：按入口拆批可按构造限制内存，但需改 build-campus-web.ts 并验证批间产物正确性，留作 2G 上限再次被突破时的后手。
- 切 GitHub 托管 ARM runner：绕开而非解决，引入成本与权限边界。
- 回退 vite 8.2.1：丢失 8.3.0 的修复，且未证实 vite 侧是独立致因。

## 后果

- rolldown 上游修复内存回归后删除该条目，以 #9330 后续版本为准。
- vite 后续若把 rolldown 依赖范围抬出 ~1.2.x，override 会强制旧版，升级前需重新评估。
- bump vite/rolldown 的改动以 CI docs 构建在 2G 自托管 runner 通过为验收标准。

Archived: 2026-09-17 — superseded by [替代笔记](../../implemented/architecture/2026-09-17-campus-web-docs-shard-build.md)
