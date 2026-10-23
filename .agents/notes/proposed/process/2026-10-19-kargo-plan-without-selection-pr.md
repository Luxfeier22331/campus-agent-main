# Agent Note: 只改发布计划的晋级不再创建选版 PR

Status: proposed

## 背景

[无 UI Kargo 发布编排](../../implemented/process/2026-10-13-kargo-headless-release.md) 中，Kargo 每次晋级都由
`prepare` 生成选版 PR，等待 PR head 上的 `validate` 成功后合并，再从合并提交读取
`releases/staging-plan.json`。期望状态没有变化时（Source 快照与当前选择相同、Worker 与镜像 digest
不变），PR 里只有这份计划文件，却仍要支付一次 `validate` 和合并等待，并在 GitOps main 留下一条
只含计划的 promote 提交。这类晋级在近期发布中占多数。

计划本身不是期望状态：Argo CD 与 Terraform 不读取它，只有发布编排读取。当前读取方为 Stage 的
`plan` HTTP 步骤、`kargo-claim.ts` 的选择判断、`kargo-execute.yml` 的 worker-traffic 目标选择、
`kargo-release.ts resolve` 和 `release-status.ts`。

## 提案

- 发布计划只写入 GitHub Deployment payload，不再提交 `releases/staging-plan.json`。`prepare` 计算范围
  后立即创建 `staging-release` Deployment（payload 含 `selectedTargets`、`applications` 与 `before`），
  `resolve` 只补充 Worker 解析结果和状态，不再创建记录。
- `prepare` 只在 `clusters`、`cloudflare`、`releases/staging.json` 或 `releases/staging-migrations`
  有差异时推送选版分支并创建 PR；没有差异时不推送，Stage 跳过 `pr`、`ci`、`merge`，normal revision
  取 `prepare` 读取的 main HEAD。
- Stage 的 `plan` 步骤改为按 Promotion 读取 Deployment payload；`kargo-claim.ts`、worker-traffic 目标
  选择与 `release-status.ts` 同样读取 payload。计划只有一个存放位置，PR 与无 PR 两条路径不分叉。
- 期望状态的并发保护不变：同步、流量切换和完成前的树比较仍以 normal revision 为基准。

## 未采用方案

### 保留计划文件，无差异时直接推送到 main

省掉 PR，但绕过 `validate`，并继续在 main 产生只含计划的提交；与“合并前必须通过检查”的约束冲突。

### 让 `validate` 对只含计划的 PR 立即成功

仍需创建 PR、等待 check run 与合并，节省有限，且需要在 `validate` 中维护按文件放行的例外。

### 由 Kargo 步骤输出携带计划

GitHub Actions 的 dispatch 不能把结果返回给 Kargo；Kargo 只能通过 HTTP 读取外部记录，Deployment
已经是发布记录的 owner，不再新增存放位置。

## 可观察结果

- 期望状态未变的晋级不再出现 `deploy/staging/*` 分支、PR 和 promote 提交，Promotion 不等待 `validate`。
- 期望状态有变化的晋级行为不变，选版 PR 中不再包含 `releases/staging-plan.json`。
- 发布状态、claim 与 worker-traffic 的目标选择在两种路径下读取同一份 payload。

## 风险

- Deployment 提前到 `prepare` 创建：后续步骤失败时该记录会以 failure 结束，`prepare` 计算累计范围时
  继续只以 success 记录为边界，不受影响。
- 计划不再进入 Git 历史；排查某次发布的范围改读 Deployment payload，`release-status.ts` 需同批迁移。
- normal revision 取 `prepare` 时的 main HEAD，期间合入的配置提交由既有树比较拦截，需要在 render
  contract 中覆盖“无 PR 路径”的步骤条件。
