# 合并请求

## 变更内容与原因

<!--
使用具体工程动作描述，例如“删除旧 handoff 链路”“迁移到 Crawlee”、
“统一 task contract”“接入 executor”；不要使用“收口”“治理”“打通”、
“闭环”“升级能力”等无法单独说明改动内容的抽象词。
-->

## 影响范围

- 应用或包：
- 文档或约定：

## 文档更新确认

<!--
按实际影响多选；“没有改变架构、接口或运行方式”和其他选项互斥。
-->

- [ ] 没有改变架构、接口或运行方式
- [ ] 改变了架构或长期约定，并已更新 `docs/architecture/` 或 ADR
- [ ] 改变了接口、数据结构或配置约定，并已更新 `docs/contracts/` 或 `docs/data/`
- [ ] 改变了运维、发布或验证步骤，并已更新 `docs/runbooks/`

## Public Source / Data Boundary

- [ ] 未新增真实 secret、私有 URL、原始通知、source-derived documents 或内部日志
- [ ] 新增 fixture 或示例均为合成、自有，或具备明确再分发权利
- [ ] No internal publish/deploy workflow is exposed as a public PR automatic path
- [ ] 改动 fixture、eval 数据、source config 或资产时，已检查公开 source/data 策略

## CI 与合并纪律

- [ ] 合并前确认 `pr-checks / required-checks` 为 success
- [ ] 如 conditional CI job 为 skipped，已确认 changed-surface 分类与本次改动匹配
- [ ] 如为 Dependabot PR，已按依赖面运行对应验证：GitHub Actions -> `pnpm ci:config:lint`；npm/pnpm -> `pnpm ci:web-graph:affected`；Go module -> `pnpm ci:go`
- [ ] 如依赖风险较高或 lockfile 大幅变更，已运行 `pnpm ci:deps:vuln` 或说明未运行原因
- [ ] 如新增 GitHub Action，已满足 action policy：trusted tag allowlist 或 full commit SHA
- [ ] 已确认 `pnpm ci:secrets` / `pr-checks` secret scan 未发现真实 secret
- [ ] 已判断是否需要 CodeQL / Dependency Review / artifact attestation；如未运行，已在风险中写明原因
- [ ] 已判断是否需要 manual / staging / eval lane，并在验证记录或风险中写明结论
- [ ] 当前 private repo 无法依赖 branch protection 时，合并前仍按本 checklist 人工核对

## 验证记录

```bash
# 粘贴实际执行过的命令。
```

## 风险与待确认
