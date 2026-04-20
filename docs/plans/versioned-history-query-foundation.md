---
doc_type: plan
status: deferred
created: 2026-03-28
updated: 2026-04-20
---

# Versioned History Query Foundation

## 文档边界

本文固定“版本化文档服务 / 历史版本查询”主题的 deferred 实施基线。

它负责：

- 显式版本模式的能力拆解
- registry、retrieval、specialist 与 eval 的后续补齐顺序
- 当前现状与目标形态的分离说明

它不负责：

- 实时记录 execution state
- 直接承诺运行时代码已经落地
- 把历史版本保留与显式历史查询混成同一概念

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 当前 merged truth 仍以 `docs/architecture/retrieval-serving-architecture.md` 与 `ADR-0014` 为准
- 若未来重开这条线，执行进度只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 repo 已固定的前提：

- document history retention 已存在
- current truth 维护已存在
- 默认 serving 只面向当前有效版本
- 多来源等价内容归并已存在

当前仍未具备的能力：

- query path 显式指定 `historical / as_of / compare`
- registry 版本解析作为独立运行时职责
- retrieval candidate 阶段的版本范围过滤
- specialist 层的历史版本回答与对比语义
- 对应的最小 eval coverage

## Required Capability Order

这条能力后续始终按以下顺序推进：

1. request protocol
2. registry version resolution
3. retrieval version filter
4. specialist answer semantics
5. eval coverage

固定原因：

- 没有显式请求模式，就没有稳定的后续能力边界
- 没有 registry resolution，就无法把版本选择从 retrieval / answer 层剥离出来
- 版本过滤必须发生在 retrieval candidate 阶段，而不是回答层事后裁剪

## Forward Phases

### Phase A: Request Protocol

目标：

- 为 query path 引入显式版本模式

最小方向：

- `current`
- `historical`
- `as_of`
- `compare`

### Phase B: Registry Version Resolution

目标：

- 让 registry 负责把请求解析成具体版本范围

### Phase C: Retrieval Version Filter

目标：

- 让 retrieval 在 candidate 阶段按版本范围预过滤

### Phase D: Specialist Answer Semantics

目标：

- 区分 current、historical、as_of、compare 四类回答语义

### Phase E: Eval Coverage

目标：

- 建立最小可回归样本：
  - current
  - historical
  - as_of
  - compare
  - 历史意图不明确的澄清

## Exclusions

固定不包含：

- 当前默认 serving posture 改写
- UI / 产品交互设计
- 单独 archive index 策略的提前冻结

## Handoff Rule

后续接手时：

1. 先看 `docs/architecture/retrieval-serving-architecture.md`
2. 再看 `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
3. 最后回到本文确认 capability order
