# Agent Note: 协作者只读访问设计（staging 集群与数据面）

Status: implemented

## 背景

设计提出时，staging 集群（单节点 k3s v1.36.2，nc-arm-6c 即控制面）没有面向人的权限分层：唯一身份是
k3s 自带的 `system:admin` 证书（`system:masters` 组，绕过全部 RBAC），`/etc/rancher/k3s/k3s.yaml`
权限 644 且 `kubectl` 由 k3s 多调用二进制提供，导致主机上任意本地账户（含同机 CI 账户
github-runner）都是隐式集群 admin；`deploy` 账户另有无密 sudo。

需求：向协作者开放"内部资料"的**读取**，不开放机器账户；机制必须可扩张——不为每个用户在
各组件重复创建身份或清单，交付物只有 kubeconfig，权限列表可自由组合。"内部资料"经实测
落在三处——

- 向量：仅 Qdrant（`qdrant-storage`/`qdrant-snapshots` PVC；PG 无向量列，索引可由管道重建）；
- 源文本：PG `hindsight` 库（`documents`、`chunks`）；
- 源文件与派生物：rustfs bucket `campus-agent-source`、`campus-agent-derived`。

当时可复用的既有资产：Qdrant 已配置 `read_only_api_key` 与 TLS；rustfs bootstrap 已建立
`campus-agent-derived-ro` 只读 policy；API server 6443 对外监听且 serving 证书 SAN 含节点 IP；
数据服务均为 ClusterIP，无其他入口。

## 决策

分层原则（参考 Rancher 的身份-集群解耦模式，但不引入其产品）：**认证集中在 apiserver 的
token-auth 文件，授权全部挂在能力组上，集群内零 per-user 对象，kubeconfig 是唯一交付物，
管理员凭证不离开集群**。不通过宽泛的 secrets 读权限发放凭证——只读凭证按能力各存入
专用 secret，由对应组精确 `get`。

1. **认证（k8s）**：k3s config 使用 `kube-apiserver-arg=token-auth-file`，指向
   `/etc/rancher/k3s/tokens.csv`（root:600）。一行 = 一个人：`token,user,uid,"groups"`；
   组列表即权限列表，自由组合。成员变更 = 编辑一行 + 重启 k3s（控制面闪断约 30s，
   不主动重启 workload）。`kubectl auth whoami` 保留 k8s 层的用户归因。
2. **授权（k8s，全部挂 Group，一次建好）**：能力组与其绑定——
   - `campus-viewers`：内置 `view` + 自定义 Role `collaborator-portforwarder`
     （`pods/portforward` 的 `create`），port-forward 是数据面网络路径；
   - `hindsight-readers`：Role 授 `get` secret `pg-hindsight-ro`；
   - `objectstore-readers`：Role 授 `get` secret `objectstore-ro`；
   - `vector-readers`：Role 授 `get` secret `qdrant-ro`。
   [Role/RoleBinding 基础清单](../../../../infra/k8s/collaborator-access/base/rbac.yaml)由本仓库维护，
   namespace overlay 与同步由 GitOps 管理。
3. **数据面（每能力一套共享只读凭证，存专用 secret，组内自助 `kubectl get secret` 获取）**：
   - PG：共享 LOGIN 角色 `hindsight_ro`（`CONNECTION LIMIT 10`、`statement_timeout=30s`、
     非 superuser；对 `hindsight` 库授 `CONNECT`，public schema `USAGE`+`SELECT`，
     `ALTER DEFAULT PRIVILEGES` 跟随未来表）。`campus_agent` 库含用户会话与账户数据，默认
     不授数据读取权限，按需另建能力组。密码存入 secret `pg-hindsight-ro`。跨库数据边界
     由 schema 与表级不授权承载，不把 `GRANT CONNECT` 当作排他授权；共享业务库的连接模型见
     [campus_agent 共享库连接授权模型](../architecture/2026-09-16-campus-agent-connect-acl.md)；
   - rustfs：[bootstrap Job](../../../../infra/k8s/data-object-store/base/bootstrap.yaml)声明式创建
     humans 只读用户并绑定 `campus-agent-source-ro` 与 `campus-agent-derived-ro` policy，
     输入来自 `object-store-secrets` 的 `OBJECT_STORE_HUMANS_*` 键；协作者凭证存入
     secret `objectstore-ro`；
   - Qdrant：复用现有 `read_only_api_key`，拷贝其值入独立 secret `qdrant-ro`（原
     `qdrant-server-secrets` 同时含 admin key，不作宽授权）。不开 `jwt_rbac`（需重启、
     当前无 collection 级需求）。
4. **交付物**：每人一份 kubeconfig（server 地址、CA、token）。协作者自行完成最后一公里：
   `kubectl get secret <name>` 取所需凭证、port-forward 连接对应服务；附一页使用说明。
5. **离场清理**：删除 tokens.csv 中该行并重启 k3s（立即失去网络路径与凭证获取权）；
   若该人已取走共享凭证，按数据敏感度决定是否轮换能力凭证（PG 密码、rustfs key、
   Qdrant key）。Qdrant key 本就是共享 key，轮换 = 更新 secret 并滚动重启。
6. **主机边界**：现有 runbook 已记载 `k3s.yaml` 收回 600；本机制只向协作者交付
   kubeconfig。github-runner 的其他提权路径和主机整体硬化不由该权限变更证明。
7. **升级路径**：成员变更频繁或需要真 IdP（GitHub 登录等）时，认证源平滑替换为
   Dex/OIDC（k3s `kube-apiserver-arg` 换 oidc 参数），RBAC 与数据面全部不动。

当前加人、离场、凭证轮换与验收步骤由
[协作者只读访问 runbook](../../../../docs/runbooks/collaborator-access.md)维护。

## 未采用方案

- **共享 `system:admin` kubeconfig（沿用原方式）**：最省事，但无法归因、无法分级吊销，且等于
  同时交出全部数据面的管理员凭证（含写）。协作者需求明确是读，不应按 admin 授权。
- **每用户独立身份（per-user SA + per-person PG role + per-person rustfs user）**：归因最好、
  吊销最干净（本笔记首版方案），但每个用户要在三个组件重复创建身份/清单，不满足规模化
  与"只交付 kubeconfig"的要求；数据层归因的损失（共享角色）在只读前提下可接受。
- **namespace 全量 secrets 读 + view**：secrets 内即 PG owner、rustfs rw、Qdrant admin 凭证，
  任何细粒度设计都被它短路。
- **SA-per-bundle（预铸权限包）**：零重启，但组合必须预定义、无用户归因；不如 token-auth
  一行 CSV 自由。
- **Rancher 本体 / 自建 impersonation 代理**：Rancher 的角色模板 + 集中用户库 + impersonation
  是该模式的完整实现，但单节点 arm64 上运行整套管理平面不成比例；自建代理等于手写
  mini-Rancher，新增常驻组件与信任边界。借鉴其结构，不引入其产品。
- **Dex/OIDC（立即引入）**：免重启、归因完整的终态方案，但当前协作者个位数，先以
  token-auth 文件落地，作为第 7 条升级路径保留。
- **k3s `certificate create` 用户证书**：X509 无吊销路径，只能等过期。
- **Qdrant JWT RBAC（按 collection 只读 + exp）**：能力存在（OSS ≥1.9），但当前无需求且需
  重启；列为将来按 collection 隔离或时间盒授权时的升级路径。
- **JIT 审批流 / 查询网关 / RLS**：多来源记载的成熟大规模实践，当前规模下属过度设计。

## 后果

- 加人、改权限和吊销通过编辑认证记录及组列表完成，不新增 per-user 集群对象或数据面身份；
  交付物只有 kubeconfig，k8s 层保留用户归因，数据写权限由各服务的只读凭证约束。
- 成员变更需要重启 apiserver，存在控制面短暂中断；数据层只有共享角色归因
  （PG 日志显示 `hindsight_ro` 而非个人）；token 明文存于 root:600 文件。
- 删除成员记录并重启后，原 token 失效；已取走的共享凭证仍有效直至轮换，
  离场流程需按是否需要收权决定轮换，轮换影响同组成员。
- RBAC 与对象存储 bootstrap 已随代码落地；runbook 记载认证配置、PG 角色、权限文件与
  GitOps 同步等一次性设置已执行。本次笔记转态依据这些现有实现与记录，未重新执行集群验收。
  新 token 交付仍须按 runbook 的验收矩阵确认允许读取、越权拒绝及吊销行为。
- 主机层其他硬化（github-runner、SSH password auth、root 直登）仍由主机运维负责；
  不能从本笔记的 implemented 状态推断这些工作已全部完成。
- 协作者超过约 5 人、成员变更频繁到重启不可接受、出现写权限需求、需要 Qdrant
  collection 级隔离或外部 IdP 登录时，重新评估认证源与数据面授权；可将认证迁至 Dex/OIDC，
  继续复用现有能力组和只读凭证分工。
