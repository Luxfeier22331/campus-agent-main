# internal-portal-client

`packages/internal-portal-client` 拥有内部门户与 CAS SSO 的共享 HTTP 会话客户端。

负责：

- `createPortalApiContext` 建立 cookie 会话：用 SSO TGC 完成 CAS 认证重放（最多 10 次认证
  重定向），之后以 `get`/`post` 访问门户页面（最多 5 次页面重定向），可选经代理出站；
- `checkPortalAuthentication` 只验证凭据可用性，`validateSsoTgc` 校验 TGC 形态；
- 以 `PortalCredentialExpiredError`、`PortalCredentialUnavailableError`、
  `PortalSessionExpiredError` 区分凭据与 会话失效，供调用方决定重新拉取或中止。

本包不持久化 TGC（归 Ops Web 凭据服务），不解析通知内容，不拥有采集编排与对象写入。
消费者为 `apps/ops-web`（凭据服务与配置）和 `jobs/internal-portal-collection`
（`adapters/internal-portal`）。采集流程与故障排查见 `docs/runbooks/ingestion.md`，
TGC 管理见 `docs/runbooks/portal-auth.md`。

```bash
pnpm --dir packages/internal-portal-client typecheck
pnpm --dir packages/internal-portal-client test
```
