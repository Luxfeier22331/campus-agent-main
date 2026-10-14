---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# 协作者只读访问

## 边界

本文规定外部协作者对 staging 集群（nc-arm-6c，单节点 k3s）内部资料的只读访问：集群资源查看、
port-forward、PostgreSQL `hindsight` 库、rustfs 对象存储 `campus-agent-source` /
`campus-agent-derived` 桶、Qdrant 向量检索。认证使用 k3s apiserver 的
`token-auth-file`（`/etc/rancher/k3s/tokens.csv`），授权使用 namespace `campus-agent-staging`
内的能力组 RoleBinding（manifest 见 `../../../infra/k8s/collaborator-access/base/rbac.yaml`）。
交付物只有 kubeconfig；协作者不获得主机账号。

写入权限、`campus_agent` 业务库中产品同步授权表以外的数据、其他 namespace 和集群管理操作不在本文范围内。

## 能力组

| 组 | 权限 |
| --- | --- |
| `campus-viewers` | 内置 ClusterRole `view` + `pods/portforward` create（仅 `campus-agent-staging`） |
| `hindsight-readers` | 读取 Secret `pg-hindsight-ro`（PG 连接信息 + `hindsight_ro` 密码） |
| `objectstore-readers` | 读取 Secret `objectstore-ro`（humans 只读 S3 键） |
| `vector-readers` | 读取 Secret `qdrant-ro`（Qdrant 只读 API key + TLS CA） |
| `product-data-readers` | 读取产品同步所需的 `pg-product-data-ro`、`objectstore-ro`、`qdrant-ro` 三个只读 Secret |

数据面凭证按能力共享：同一组的所有成员使用同一组凭证。吊销靠删除 token 行；凭证轮换影响全组。

## 前置条件（一次性，已执行）

- `/etc/rancher/k3s/k3s.yaml` 权限为 600（否则任何本机用户隐式获得 cluster-admin）。
- `/etc/rancher/k3s/config.yaml` 存在：

  ```yaml
  kube-apiserver-arg:
    - "token-auth-file=/etc/rancher/k3s/tokens.csv"
  ```

- PG 共享角色 `hindsight_ro` 已创建（见下文"数据面一次性设置"）。
- GitOps 的 `collaborator-access` Application 已同步（RBAC + 3 个能力 Secret）。

## 加人

1. 生成 token：`openssl rand -hex 24`。
2. 编辑 `/etc/rancher/k3s/tokens.csv`（root，0600），追加一行：

   ```csv
   <token>,<username>,<uid>,"campus-viewers,hindsight-readers,objectstore-readers,vector-readers"
   ```

   组合按需裁剪；`campus-viewers` 几乎总是需要（port-forward 依赖它）。
   产品同步协作者使用 `"campus-viewers,product-data-readers"`。
3. `sudo systemctl restart k3s`。重启期间 apiserver 中断约 30 秒，Argo CD 会自动恢复。
4. 生成 kubeconfig 交给协作者：

   ```sh
   ca=$(sudo base64 -w0 /var/lib/rancher/k3s/server/tls/server-ca.crt)
   cat <<EOF
   apiVersion: v1
   kind: Config
   clusters:
   - cluster:
       server: https://152.53.241.57:6443
       certificate-authority-data: ${ca}
     name: campus-agent-staging
   contexts:
   - context: {cluster: campus-agent-staging, user: <username>}
     name: staging
   current-context: staging
   users:
   - name: <username>
     user: {token: <token>}
   EOF
   ```

5. 按"验收矩阵"验证后交付。

## 离场

1. 删除 `/etc/rancher/k3s/tokens.csv` 中对应行。
2. `sudo systemctl restart k3s`，确认 token 返回 401。
3. 共享数据面凭证默认保留（其他成员仍在用）。仅当离场者接触过凭证明文且需要收权时，按"轮换"
   章节处理并重新分发。

## 数据面一次性设置

### PostgreSQL（hindsight 库只读角色）

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hindsight_ro') THEN
    CREATE ROLE hindsight_ro LOGIN PASSWORD '<pg-hindsight-ro 中密封的密码>';
  END IF;
END
$$;
ALTER ROLE hindsight_ro LOGIN PASSWORD '<pg-hindsight-ro 中密封的密码>';
ALTER ROLE hindsight_ro CONNECTION LIMIT 10;
ALTER ROLE hindsight_ro SET statement_timeout = '30s';
GRANT CONNECT ON DATABASE hindsight TO hindsight_ro;
\c hindsight
GRANT USAGE ON SCHEMA public TO hindsight_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hindsight_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO hindsight_ro;
```

执行方式：`kubectl exec -n campus-agent-staging campus-agent-postgres-1 -c postgres -- psql -U postgres`。

#### 库级权限变更安全配方（2026-09-16 事故教训）

`campus_agent` 是共享库（消费者见 `../../data/postgres-ownership.md` 角色表）。调整任何库级
权限前：

1. 先核对真实消费者：`SELECT usename, count(*) FROM pg_stat_activity WHERE datname =
   'campus_agent' GROUP BY 1;`，并与所有权文档角色表对照；静态 ACL 上没有显式授权的角色
   同样可能是消费者（PostgreSQL 默认给 `PUBLIC` 授 `CONNECT`）。
2. 若按 [campus_agent 共享库连接授权模型](../../../.agents/notes/implemented/architecture/2026-09-16-campus-agent-connect-acl.md) 收紧 `PUBLIC`，必须在
   同一变更中为全部真实消费者逐一显式 `GRANT CONNECT`（当前：`campus_agent`、`app_api`、
   `agent_control`、`model_config`、`ops_web`）。
3. 验证以每个消费者**新建连接**成功为准：存量连接池不受 `CONNECT` 收回影响，故障会随池
   回收延迟暴露，pod `Running` 不构成权限变更安全的证据。

### rustfs（humans 只读用户）

无需手工操作：`object-store-secrets` 中的 `OBJECT_STORE_HUMANS_*` 四个键由
object-store bootstrap Job 声明式铸造（`campus-agent-source-ro` / 复用
`campus-agent-derived-ro` policy），见
`../../../infra/k8s/data-object-store/base/bootstrap.yaml`。

### Qdrant

`qdrant-ro` Secret 的 `QDRANT_READ_ONLY_API_KEY` 取自 `qdrant-server-secrets` 的
`QDRANT_READ_ONLY_API_KEY`，`ca.crt` 取自 TLS CA。每次轮换 qdrant 服务密钥时需要
同步重新密封 `qdrant-ro`。

## 轮换

- PG `hindsight_ro` 密码：生成新密码 → 重新密封 `pg-hindsight-ro`（GitOps overlay）→ 用上文
  SQL `ALTER ROLE ... PASSWORD` 同步 → 通知协作者重新取 Secret。
- humans S3 键：生成新键 → 同时重新密封 `object-store-secrets`（`OBJECT_STORE_HUMANS_*`）和
  `objectstore-ro` → Argo 同步后 bootstrap Job 自动重铸用户。
- Qdrant RO key：轮换 `qdrant-server-secrets` 时同步更新 `qdrant-ro`。

## 验收矩阵

新 token 首次交付前逐项验证（`kubectl` 均带该 token 的 kubeconfig）：

允许：

- `kubectl auth whoami`（需 kubectl ≥1.28）显示预期用户与组。
- `kubectl -n campus-agent-staging get pods,deploy,sts,svc,cm` 成功；
  `logs` 正常。
- `kubectl -n campus-agent-staging port-forward svc/campus-agent-postgres-rw 5432` 可建立。
- `kubectl -n campus-agent-staging get secret pg-hindsight-ro`（hindsight-readers）/ `objectstore-ro`
  （objectstore-readers）/ `qdrant-ro`（vector-readers）按组返回内容。
- 产品同步协作者仅加入 `campus-viewers,product-data-readers` 时，可分别 get
  `pg-product-data-ro`、`objectstore-ro`、`qdrant-ro`；其他 Secret 和 Secret 列表仍被拒绝。
- PG：port-forward 后用 `hindsight_ro` 连 `hindsight` 库 `SELECT` 成功。
- rustfs：port-forward `svc/object-store 9000` 后 humans 键 `mc ls` / `mc cp`（下载）成功。
- Qdrant：port-forward 后 RO key 检索成功（TLS 用 `ca.crt`）。

拒绝：

- `kubectl -n campus-agent-staging get secrets`（列表）被拒；`get secret` 其他名字被拒。
- `kubectl -n campus-agent-staging exec ...`、任何 `create/apply/delete/patch` 被拒。
- 其他 namespace（含 `default`、`kube-system`、`argocd`）读被拒。
- PG：`hindsight_ro` 执行 `INSERT/UPDATE/DELETE/DDL` 报权限错误。
- rustfs：humans 键 `mc cp`（上传）/ `mc rm` 被拒。
- Qdrant：RO key upsert / delete 被拒。
- 删除 tokens.csv 行并 restart 后，原 token 返回 401。

## 回滚

- 停用整个机制：删除 `/etc/rancher/k3s/config.yaml` 中 `token-auth-file` 行 → `sudo systemctl
  restart k3s`。
- 移除集群侧对象：删除 GitOps 中 `collaborator-access` overlay 与 Application（deletion policy
  为 manual，需在 Argo CD 确认 prune）。
- PG：`DROP ROLE hindsight_ro;`（先 `REVOKE` 其权限）。
- rustfs：bootstrap 去掉 humans 行后 policy 挂载随同步移除；用户残留时
  `rc admin user remove object-store <access-key>`。

## 产品开发数据拉取

`product-data-readers` 只允许 get Secret `pg-product-data-ro`、`objectstore-ro`、`qdrant-ro`，不允许列举其他
Secret。该组同时提供产品同步所需的 PostgreSQL、对象存储和 Qdrant 只读凭据；不需要额外加入
`objectstore-readers` 或 `vector-readers`。仍需要 `campus-viewers` 以建立 port-forward。

`pg-product-data-ro` 字段为 `username`（product_data_ro）、`password`、`host`（TLS server name）、`port`、
`database`、`ca.crt`。连接通过当前 context/namespace 的 loopback port-forward，验证 CA 与 server name。

Source 的 data-postgres DatabaseRole 创建 product_data_ro，schema migration 只授予通知、群组、交通、
食堂基础表和 current_index 的 SELECT；不设置覆盖整个 schema 的默认 SELECT 权限。
凭据由 GitOps data-postgres overlay 投递；交付顺序为凭据/角色、schema grants、协作者访问验收。
新增 Source revision 和 schema image 必须交付后再执行 `dev:local -- data sync --domain retrieval`，不能用管理员身份
读取应用 Secret 来替代。具体数据与替换规则见[本地运行检查](../local-verification.md)。

## 相关文档

- [本地运行检查](../local-verification.md)
- [PostgreSQL 角色与库所有权](../../data/postgres-ownership.md)
- [运行时发布架构](../../architecture/system/runtime-release.md)
