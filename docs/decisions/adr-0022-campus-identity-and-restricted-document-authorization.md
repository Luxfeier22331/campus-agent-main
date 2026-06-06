---
doc_type: decision
decision_id: ADR-0022
status: accepted
created: 2026-04-02
updated: 2026-06-04
---
# ADR-0022 Campus Identity And Restricted Document Authorization

## 背景

`campus-agent` 当前已经冻结了以下长期边界：

- `apps/app-api` 是 canonical identity / authorization owner
- execution path 只消费最小化 `ContextProjection`
- retrieval 必须在 candidate retrieval 前执行 authorization pre-filter
- memory / personalization 不得扩大权限

但对于“只对校内人士开放的通知、制度或说明”这一类受限机构知识，repo 还缺一条更具体的 accepted policy：

- 未登录访问者与 `campus_member` 如何区分
- restricted document 应该按什么 principal / entitlement 语义治理
- Cloudflare / IdP / app-layer authz / retrieval filter 各自承担什么职责
- 文档 / chunk / index 应该写什么 visibility / entitlement projection
- panel、chat、service、operator 是否共享同一授权平面

如果这条边界不冻结，后续实现很容易退化为：

- 把 Better Auth 登录态误当成“校内身份已验证”
- 把 Cloudflare Access 放行误当成数据授权已完成
- 让 `supervisor` / `retrieval` 自行决定 restricted document 是否可见
- 把 `acl_groups` 扩成长期唯一权限模型
- 把“适用于某类学生”和“只有某类人可见”混成一个过滤字段

## 决策

### 决策 1：受限机构知识的 canonical authorization truth 继续由 `apps/app-api` 拥有

对 restricted institutional documents，长期授权真相仍固定由 `apps/app-api` 拥有，并至少覆盖：

- canonical principal mapping
- entitlement truth
- resource ownership truth
- approval truth

`apps/execution-gateway`、`apps/supervisor-agent-worker`、`packages/rag-agent` 与
`packages/retrieval-core` 只消费 typed projection，不自行重建最终权限结论。

### 决策 2：restricted document authorization 采用 ABAC 为主、ownership 为辅的模型

对 institutional documents，长期授权模型固定为：

- `subject`
- `action`
- `resource`
- `context`

其中：

- document / chunk / evidence 类资源默认采用 attribute-driven authorization
- conversation / request execution / memory / operator workflow 默认采用 ownership /
  relation / approval 语义
- RBAC / group membership 允许作为 entitlement 的一种来源，但不等于完整授权模型

### 决策 3：前向 principal class 不再保留 `public_user`

长期上，至少接受以下 principal class：

- `anonymous`
- `campus_member`
- `student`
- `staff`
- `faculty`
- `operator`
- `service`

直接含义：

- 未登录访问者保持为 `anonymous`，不再升格为独立的已登录 `public_user` principal
- 前向 end-user 登录入口不再保留“已登录但非校内身份”的 principal 层
- `campus_member` / `student` / `staff` / `faculty` 必须由学校权威身份源、目录同步或等价
  entitlement snapshot 支撑
- `operator` 与 end-user principal 必须分离
- `service` 只用于受控机器调用，不可伪装成 end-user principal

### 决策 4：restricted document 的长期 retrieval projection 词汇固定为 `visibility_* + entitlement_*`

对受限机构知识，document registry / chunk metadata / vector index 长期只应保留以下权限投影：

- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`

必要时可额外引入：

- `owner_scope`
- `tenant_scope`

明确不变：

- 这组字段只是 execution / search projection，不是 canonical authorization truth
- `acl_level`、`acl_groups`、`campus_scope` 只属于当前迁移中的 transitional carrier
- raw JWT、raw session、raw IdP payload、raw authz store object 不得进入 retrieval
  metadata

### 决策 5：restricted institutional documents 与 product resources 共享授权平面

以下资源类型应共享同一 principal / deny-by-default / audit 语义：

- institutional document / chunk / evidence
- conversation / message / request execution
- profile memory / session memory
- operator projection / operator workflow
- approval-required capability

但不同资源类型的 filter projection 语义必须分开：

- institutional documents 使用 `visibility_*` / `entitlement_*`
- conversation / request execution 使用 ownership / approval / operator policy
- memory 如未来进入 retrieval index，应优先使用 `owner_scope` / `tenant_scope`

### 决策 6：`visibility` 与 `applicability` 必须继续拆分

对 restricted documents，长期固定以下边界：

- `visibility` 谁能看到
- `applicability` 内容是否适用于该用户背景

因此：

- `major`、`cohort`、`program`、`recent_goal` 默认首先属于 applicability /
  personalization
- 只有被显式建模为 entitlement 或 policy 条件的字段，才允许进入 authorization projection
- 当前如果某类“校区”语义同时承担可见性和适用性，必须拆成 `visibility_scope` 与 `applicability_scope`

### 决策 7：restricted document retrieval 必须 fail-closed，并在 candidate retrieval 前执行

对 restricted documents，长期固定如下：

- authorization pre-filter 必须在 candidate retrieval 前执行
- 未授权 evidence 不允许先被召回后再在回答层裁剪
- projection 缺失、冲突或不可安全判定时必须 fail-closed
- 未授权内容的标题、snippet、citation、anchor 与 existence hint 不得在默认 public chat 路径泄露

### 决策 8：Cloudflare / IdP / app-layer authz 的职责必须分离

长期固定职责如下：

- Cloudflare / edge ingress 负责 access boundary input，例如入口认证、service
  auth、network/device gate
- canonical IdP / directory / entitlement sync 负责校内身份与组织属性的真相输入
- `apps/app-api` 负责 principal mapping、entitlement snapshot、authorization
  projection 与 approval / ownership truth
- execution / retrieval path 只消费投影后的最小 authz projection

直接含义：

- Cloudflare Access 放行不等于数据授权完成
- Better Auth 会话不等于校内身份已验证
- 机器调用应采用 service auth，而不是长期 `Bypass`

### 决策 9：restricted documents 的基线 policy tier 固定为 `public` 与 `restricted`

当前阶段，institutional documents 至少接受以下两类 visibility tier：

- `public` 公开可见
- `restricted` 仅对满足 entitlement / visibility 条件的 principal 可见

示例：

- 公开制度：`visibility_level=public`
- 校内通知：`visibility_level=restricted` + `entitlement_groups=[\"campus_members\"]`
- 学生专属通知：`visibility_level=restricted` + `entitlement_groups=[\"students\"]`
- 教职工专属通知：`visibility_level=restricted` + `entitlement_groups=[\"staff\"]`

后续如需引入更细 tier，必须在 policy / architecture 文档中显式扩展，而不是直接让业务代码发散。

### 决策 10：collection 优先隔离，document/chunk filter 作为细粒度补充

对 restricted institutional documents，优先级固定如下：

1. 若某个 collection 完全属于 restricted surface，优先 collection 级隔离
1. 若同一 collection 混有 public 与 restricted documents，再使用 document / chunk 级
   visibility / entitlement projection

这样做的目的：

- 降低误标与漏标风险
- 避免把所有复杂度都压到 chunk-level ACL
- 保持 serving surface 与 operator治理边界显式

## 结果

直接结果如下：

- 需要一份实施方案把 campus principal / entitlement snapshot / restricted document
  rollout 拆成波次
- `apps/app-api` 的 principal mapping 需要扩展为 `campus_member` / `student` / `staff`
  / `faculty`
- `ingestion-core` / registry / Qdrant payload 需要完成 `visibility_* +
  entitlement_*` 主写入
- `retrieval-core` 需要在 restricted document 路径上只依赖 projection，并最终删除 legacy ACL
  carrier path
- public chat、panel、service 与 operator surface 需要补齐 allow/deny matrix 与泄露防护测试

明确不做：

- 不把 Better Auth 登录态直接升级为校内 entitlement truth
- 不把 Cloudflare Access / Worker admission 直接当成数据授权完成
- 不让 `supervisor` 或 `retrieval` 反向读取 raw auth store 做权限重建
- 不把 personalization / memory 作为 restricted document 的授权依据

## Complements

这项决策 complements：

- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`

## 外部依据

- OWASP Authorization Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- NIST SP 800-162 Guide to Attribute Based Access Control:
  <https://csrc.nist.gov/pubs/sp/800/162/upd2/final>
- Zanzibar paper: <https://www.usenix.org/system/files/atc19-pang.pdf>
- Cloudflare Access policies:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
- Cloudflare Access session management:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/>
