# operator-console-web

受控 Operator Console 的 Cloudflare Worker 页面。

本应用只拥有浏览器 shell、静态资源、Worker 本地就绪检查，以及代理到 `apps/app-api` 的明确
接口白名单。它不得成为第二个运维后端、通用管理平台，也不得让浏览器直连
execution-control、Temporal、PostgreSQL、Sentry 或 Axiom。

## 当前范围

- 当前运维流程的受保护 SPA 路由；
- `GET /healthz`、`GET /readyz`；
- 只代理已准入 app-api 运维接口的 Worker 本地 `/api/*`；
- 不提供通用 `/api/*` 透传。

产品与代理边界由以下文档定义：

- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/product-runtime.md`
- `docs/contracts/app-api/operator.md`
- `docs/contracts/app-api/operator-ops.md`
- `docs/contracts/app-api/observability.md`

请求与运行排查属于自托管 `apps/ops-web`，本 Worker 不代理这些接口。

## 运行变量

- `OPERATOR_CONSOLE_APP_NAME`
- `OPERATOR_CONSOLE_APP_API_SHARED_SECRET`
- `OPERATOR_CONSOLE_APP_API_BASE_URL`
- `OPERATOR_CONSOLE_PROTECTION_ENVELOPE`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

必需 binding：

- `APP_API`
- `ASSETS`

受信任 app-api 通道、静态资源、共享 Secret 或 Cloudflare Access 断言配置缺失时，`/readyz`
必须失败关闭。

## 本地命令

```bash
pnpm install
pnpm build
pnpm preview
pnpm test
pnpm test:worker
pnpm typecheck
pnpm dev
pnpm deploy
```

认证冒烟测试使用与 Worker 相同的签名断言准入路径：

```bash
pnpm --dir apps/operator-console-web exec tsx ./e2e/support/local-access-server.ts
cd apps/operator-console-web
OPERATOR_CONSOLE_LIVE_SMOKE=1 pnpm dev
```

然后打开：

```text
http://127.0.0.1:27062/login?redirect=http://127.0.0.1:27021/operations/provider-config
```

## 运行约束

- 代理响应使用 `Cache-Control: no-store`；
- Access JWT、Cookie、运维邮箱、提示词、答案和会话正文不得进入观测平台；
- 本地冒烟测试需要兼容的 `apps/app-api`；
- 食堂 seed 或评测快照缺失时，应显示后端诊断状态，不得在前端合成数据；
- 当前界面不提供食堂运维工作区；飞书凭据和同步控制继续属于 `jobs/dining-sync`。
