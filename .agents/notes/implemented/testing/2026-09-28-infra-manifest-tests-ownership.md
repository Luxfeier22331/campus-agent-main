# Agent Note: k8s manifest 合同测试归位 infra 与 deploy 目录瘦身

Status: implemented

## 背景

`scripts/deploy` 长期混放两类表面：一类是真部署脚本（`worker-version.ts`、
`run-wrangler-command.ts`、`run-worker-staging-build.ts`、`verify-worker-deploy-config.ts`），
另一类是 k8s manifest 合同测试（7 个 `*-job-templates` / `*-object-store` 测试，
分别断言 `infra/k8s/execution-runtime`、`ingestion-runtime`、`data-postgres`、
`ops-web`、`data-object-store` 各子域的资源模板）。后者读取的是 `infra/k8s` 的产物，
却被归到 `deploy` tooling 组，造成 owner 错位：改一份 manifest 触发的是 `deploy` 组测试，
而部署脚本自身（wrangler staging build / 版本上传）与 manifest 无合同关系。
另有 `staging-release.mts` 只导出 `resolveGitSha`，唯一消费者是 `worker-version.ts`，
是无独立消费者的单函数文件。

infra 侧本就存在独立的校验入口（`scripts/infra/validate.sh` 的 conftest + kustomize
策略校验，以及 `infra` validation profile），进一步说明 manifest 合同校验的正确归属在
infra 而非 deploy。tooling 组此前没有 `infra` 组，`TOOLING_GROUPS` 与归组函数均未覆盖
`infra/` 路径。

## 决策

- 新增 `infra` tooling 组：`TOOLING_GROUPS` 与 `toolingGroupsForFiles` 归组函数覆盖
  `infra/`、`scripts/infra/`；`scripts/package.json` 增加
  `test:infra = tsx --test ../infra/k8s/tests/*.test.ts`；`scripts/turbo.json` 注册
  `test:infra` 任务（`dependsOn @campus-agent/document-ocr#source`，inputs 含
  `$TURBO_ROOT$/infra/**` 与 `packages/document-ocr/**`）并加入 `test` 聚合，同时从
  `test:deploy` 的 inputs 移除 `$TURBO_ROOT$/infra/**` 以避免双 owner 缓存串扰。
- 7 个 manifest 合同测试迁到 `infra/k8s/tests/`，贴近被测产物；相对引用从
  `../../infra/k8s/...` 收敛为 `../...`，`ops-web-object-store.test.ts` 对
  `packages/document-ocr` 的跨包 import 调整为 `../../../packages/...`。
- `staging-release.mts` 的 `resolveGitSha` 内联进 `worker-version.ts`（复用其既有
  `fail`），删除该单函数文件。
- `biome.jsonc` includes 增加 `infra/k8s/tests/**`，使迁入的 TS 测试纳入 lint 覆盖。

## 未采用方案

- 把 manifest 测试留在 `scripts/deploy` 仅在归组函数里特殊路由到 infra：路径与 owner
  仍分离，错位依旧，且归组规则更绕。
- 为每个 infra 子域建独立测试目录（`execution-runtime/tests` 等）：子域间有跨域断言
  （如 notice-publisher 同时读 ingestion-runtime 与 ops-web），集中到 `infra/k8s/tests/`
  避免重复目录。
- 保留 `staging-release.mts` 以"将来可能复用"：无第二消费者，worker-version 内联即可，
  复用需求出现时再提取。

## 后果

- `pnpm test:tooling --groups=infra`（15 测试）、`deploy`（12）、`ci`（146）、`dev`（57）
  各自全绿；`toolingGroupsForFiles(["infra/..."])` 返回 `["infra"]`。
- 改 `infra/k8s` 现在触发 `infra` 组而非 `deploy` 组；改部署脚本仍触发 `deploy` 组。
- `scripts/deploy` 收敛为 5 个文件（4 部署脚本 + worker-version 测试）。
- 后续新增 manifest 合同测试应放 `infra/k8s/tests/` 并被 `test:infra` glob 捕获；
  新增 infra 子域的资源模板测试无需再动 tooling 归组。
