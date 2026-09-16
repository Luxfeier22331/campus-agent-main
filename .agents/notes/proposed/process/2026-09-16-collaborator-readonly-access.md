# Agent Note: 协作者只读访问设计（staging 集群与数据面）

Status: proposed

## 背景

staging 集群（单节点 k3s v1.36.2，nc-arm-6c 即控制面）当前没有任何面向人的权限分层：唯一身份是
k3s 自带的 `system:admin` 证书（`system:masters` 组，绕过全部 RBAC），`/etc/rancher/k3s/k3s.yaml`
权限 644 且 `kubectl` 由 k3s 多调用二进制提供，导致主机上任意本地账户（含同机 CI 账户
github-runner）都是隐式集群 admin；`deploy` 账户另有无密 sudo。

需求：向协作者开放"内部资料"的**读取**，不开放机器账户；机制必须可扩张——不为每个用户在
各组件重复创建身份或清单，交付物只有 kubeconfig，权限列表可自由组合。"内部资料"经实测
落在三处——

- 向量：仅 Qdrant（`qdrant-storage`/`qdrant-snapshots` PVC；PG 无向量列，索引可由管道重建）；
- 源文本：PG `hindsight` 库（`documents`、`chunks`）；
- 源文件与派生物：rustfs bucket `campus-agent-source`、`campus-agent-derived`。

可复用的既有资产：Qdrant 已配置 `read_only_api_key` 与 TLS；rustfs bootstrap 已建立
`campus-agent-derived-ro` 只读 policy；API server 6443 对外监听且 serving 证书 SAN 含节点 IP；
数据服务均为 ClusterIP，无其他入口。

## 提案

分层原则（参考 Rancher 的身份-集群解耦模式，但不引入其产品）：**认证集中在 apiserver 的
token-auth 文件，授权全部挂在能力组上，集群内零 per-user 对象，kubeconfig 是唯一交付物，
管理员凭证不离开集群**。不通过宽泛的 secrets 读权限发放凭证——只读凭证按能力各存入
专用 secret，由对应组精确 `get`。

1. **认证（k8s）**：k3s config 增加 `kube-apiserver-arg=token-auth-file`，指向
   `/etc/rancher/k3s/tokens.csv`（root:600）。一行 = 一个人：`token,user,uid,"groups"`；
   组列表即权限列表，自由组合。成员变更 = 编辑一行 + 重启 k3s（控制面闪断约 30s，
   workload 不受影响）。`kubectl auth whoami` 保留 k8s 层的用户归因。
2. **授权（k8s，全部挂 Group，一次建好）**：能力组与其绑定——
   - `campus-viewers`：内置 `view` + 自定义 Role `portforwarder`（`pods/portforward`、
     `services/portforward` 的 `create`），port-forward 是数据面网络路径；
   - `hindsight-readers`：Role 授 `get` secret `pg-hindsight-ro`；
   - `objectstore-readers`：Role 授 `get` secret `objectstore-ro`；
   - `vector-readers`：Role 授 `get` secret `qdrant-ro`。
   Role/RoleBinding 清单进 Argo CD 管理的仓库（与 object-store-bootstrap 同一所有权）。
3. **数据面（每能力一套共享只读凭证，存专用 secret，组内自助 `kubectl get secret` 获取）**：
   - PG：共享 LOGIN 角色 `hindsight_ro`（`CONNECTION LIMIT 10`、`statement_timeout=30s`、
     非 superuser；`GRANT CONNECT` 限 `hindsight` 库，public schema `USAGE`+`SELECT`，
     `ALTER DEFAULT PRIVILEGES` 跟随未来表）。`campus_agent` 库含用户会话与账户数据，默认
     不授，按需另建能力组。密码存入 secret `pg-hindsight-ro`；
   - rustfs：bootstrap 增补 `campus-agent-source-ro` policy（声明式，随 Argo CD）；用户
     铸造为运行态操作（`rc admin user add/attach`），source-ro 与 derived-ro 两组 key 存入
     secret `objectstore-ro`；
   - Qdrant：复用现有 `read_only_api_key`，拷贝其值入独立 secret `qdrant-ro`（原
     `qdrant-server-secrets` 同时含 admin key，不作宽授权）。不开 `jwt_rbac`（需重启、
     当前无 collection 级需求）。
4. **交付物**：每人一份 kubeconfig（server 地址、CA、token）。协作者自行完成最后一公里：
   `kubectl get secret <name>` 取所需凭证、port-forward 连接对应服务；附一页使用说明。
5. **离场清理**：删除 tokens.csv 中该行并重启 k3s（立即失去网络路径与凭证获取权）；
   若该人已取走共享凭证，按数据敏感度决定是否轮换能力凭证（PG 密码、rustfs key、
   Qdrant key）。Qdrant key 本就是共享 key，轮换 = 更新 secret 并滚动重启。
6. **前置条件**（独立任务，但未完成则本设计被主机层绕过）：`k3s.yaml` 收回 600 并解除
   github-runner 的隐式 admin。
7. **升级路径**：成员变更频繁或需要真 IdP（GitHub 登录等）时，认证源平滑替换为
   Dex/OIDC（k3s `kube-apiserver-arg` 换 oidc 参数），RBAC 与数据面全部不动。

## 未采用方案

- **共享 `system:admin` kubeconfig（现状延伸）**：最省事，但无法归因、无法分级吊销，且等于
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

## 验收标准

以下是提案实施后的验证目标，尚不表示已经通过：

- 协作者仅凭交付的 kubeconfig，按所属能力组取得对应只读凭证，并通过 port-forward 读取授权数据。
- 未授予的能力凭证、管理员凭证和数据写操作被拒绝；普通本地账户不能通过原 k3s.yaml 绕过授权。
- 新增或调整成员只修改认证记录及组列表，不新增 per-user 集群对象和数据面身份。
- 删除成员记录并重启后，其集群访问失效；已取得的共享凭证是否轮换按提案中的离场流程处理。

## 后果

- 正面：加人/改权限/吊销均为编辑一行 CSV + 一次 k3s 重启，集群与数据面零 per-user 对象；
  交付物收敛为单个 kubeconfig；权限组合即组列表；写路径对协作者物理关闭；k8s 层保留
  用户归因；几乎全部复用既有只读机制。

## 风险

- 成本：成员变更需要重启 apiserver（约 30s 控制面闪断）；数据层只有共享角色归因
  （PG 日志显示 `hindsight_ro` 而非个人）；已取走的共享凭证在离场后仍有效直至轮换，
  离场流程需含轮换决策；token 明文存于 root:600 文件。
- 边界：主机层硬化（k3s.yaml 权限、github-runner、SSH password auth、root 直登）不在本设计
  范围，但不完成第 6 条前置，本设计在主机层可被整体绕过。
- 重评条件：协作者超过约 5 人、成员变更频繁到重启不可接受、出现写权限需求、需要 Qdrant
  collection 级隔离、或需要外部 IdP 登录时，分别触发认证源升级（Dex/OIDC）或各层重评。
