---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0049
status: accepted
partially_superseded_by: ADR-0055
---
# ADR-0049 食堂发布

## 背景

食堂 observation 和可编辑 catalog data 与学生应用独立变化。直接暴露 mutable draft 或
collector output，会让不完整更新在未经评审时成为产品事实。

## 决策

食堂发布采用 candidate-first：

```text
source observation 或 operator edit
-> draft
-> immutable release candidate
-> validation and approval
-> published release snapshot
-> latest pointer
-> student read projection
```

`apps/app-api` 拥有 dining operation persistence 和 HTTP contract。
`packages/domains/dining` 拥有 domain validation 和 release semantics。Campus Web 只读取
latest published projection，不回退到 draft、source observation 或 development seed。

release candidate 冻结 draft version 和必需 floorplan binding。publication 校验该冻结
candidate 后更新 latest pointer，不能发布碰巧处于 current 的 draft。rollback 选择以前的
published snapshot，或基于旧 snapshot 新建 candidate；不能静默改写 draft history。

source observation 只是 proposal，必须显式评审后才能改变 draft，不能直接 publish。

Operator Console 可以暴露已开放 dining operation contract，但本决策不指定前端 package
或当前 navigation item。operator product surface 由 ADR-0055 维护。

dining floor/window geometry 是 indoor presentation data，不是 campus route graph truth。

## 后果

- 不完整编辑和发布失败不会影响学生读取。
- 每次 published change 都有 candidate、validation 和 audit identity。
- scheduled job 只能发布已批准 candidate。
- development seed 和 collector row 不是 production fallback truth。

## 相关文档

- `docs/architecture/domains/dining/architecture.md`
- `docs/contracts/app-api/dining-ops.md`
- `docs/data/dining.md`
- `docs/decisions/adr-0055-operator-console.md`
