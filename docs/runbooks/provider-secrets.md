---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 供应商密钥操作

## 边界

本文规定 Ops Web 中供应商密钥的新增、验证、激活、轮换和撤销。Provider 与环境所有权见
`../environment/providers.md`，架构决策见 `../decisions/adr-0080-ops-web.md`。

固定边界：

- Ops Web PostgreSQL 只保存加密密钥、候选 revision 和验证结果；
- `execution-runtime-provider-config` Secret 中的 `provider_config_projection.v2` 是 active truth；
- runtime 只读本地 Secret volume 或本地原子文件，不在请求热路径调用 Ops Web 或 app-api；
- 浏览器和 API 响应只返回不可逆指纹与末四位；
- 不存在 seed、手工 sync、v1 projection、环境变量 provider fallback 或旧 app-api 接口。

## 新增和激活

1. 确认目标环境、kind、role、transport、模型和预期向量维度。
2. 在供应商平台创建该环境的密钥。
3. 登录 Ops Web“模型服务配置”，创建连接。连接可支持 prompt、embedding 或 rerank。
4. 创建 profile，并执行验证：
   - prompt 要求 provider 请求成功；
   - embedding 还要校验响应维度；
   - rerank 还要校验排序响应结构；
   - `rag_query_embedding` 和 `index_embedding` 激活前还要通过 execution-control 索引兼容检查。
5. 激活 profile。Ops Web 使用 `resourceVersion` CAS 更新固定 Secret；发生并发冲突时刷新后重试。
6. 确认页面显示新的 publication、摘要和 role 到 profile revision 映射。
7. 确认依赖该 role 的 runtime readiness 恢复，再运行所属产品的受控冒烟测试。

尚未配置任何 active profile 时，Ops Web 自身仍应就绪并允许进入修复页；依赖缺失 role 的 runtime
必须失败关闭。

## 本地开发

1. 复制 `apps/ops-web/.env.example` 为未跟踪的 `apps/ops-web/.env`。
2. 使用本地 PostgreSQL owner DSN、独立高熵加密密钥和 `file` publisher。
3. 启动 Ops Web 后通过同一页面创建、验证并激活 profile。
4. 把 `OPS_WEB_PROVIDER_CONFIG_PROJECTION_PATH` 以 `0600` 挂载给本地 runtime。

Kubernetes Secret volume 使用 `0440` 和 Pod `fsGroup`，目录挂载不得使用 `subPath`。

## 轮换

1. 创建新供应商密钥和新连接，不修改生效连接。
2. 创建引用新连接的新 profile，完成验证和激活。
3. 确认 publication 摘要、runtime readiness 和受控冒烟测试。
4. 撤销旧供应商密钥。

疑似泄露时先切换并立即撤销旧密钥，再检查近期日志、构建产物、截图和共享记录。

## 禁止事项

- 不把仓库根 `.env`、GitHub Variables 或 GitOps 明文当作供应商密钥来源；
- 不让 staging 或 production 共用开发密钥；
- 不在 issue、PR、日志、截图、fixture 或浏览器响应中记录原始密钥；
- 不从其他 worktree 复制密钥；
- 不直接 patch projection 绕过 Ops Web 的验证、操作者和并发控制。
