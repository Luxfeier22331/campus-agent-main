# edge-router

公共 Campus 主机名的泳道入口 Cloudflare Worker。它是该主机名唯一挂载的 Worker，按泳道把请求经 Service
Binding 转给目标环境的 `campus-web`；不读取产品数据、不鉴权、不缓存响应。

## 职责

- 无泳道或泳道无效时转发到 `DEFAULT_LANE`；`__Host-campus_lane` 指向已配置 binding 的泳道时转发到该泳道；
- 页面导航上的 `?lane=staging|prod` 切换泳道：选择默认泳道清除 Cookie，选择其他泳道写入 400 天 Cookie，
  切换响应带 `Clear-Site-Data: "cache"`；已在目标泳道时去掉参数直接转发；
- OIDC discovery 与 token/userinfo/JWKS 按 issuer 路径选择泳道：`/lanes/<lane>/...` 去掉前缀后转发，
  不带前缀的路径固定转发到 production；authorize、consent、logout 随泳道 Cookie；
- 转发前删除泳道 Cookie、其他泳道和未加泳道前缀的 Better Auth Cookie。

泳道名、查询值、Cookie 名、issuer 路径和各泳道的 Better Auth Cookie 前缀由
`campus-contracts/environment-lanes` 定义，App API 使用同一份映射设置 `cookiePrefix` 与 issuer。每个泳道对应
一个 binding：`CAMPUS_WEB_STAGING`、`CAMPUS_WEB_PRODUCTION`。

## 切换默认泳道

浏览器里不存在默认泳道的 Cookie，因此把 `DEFAULT_LANE` 从 `staging` 改为 `production` 会让所有未主动
选择 staging 的用户进入 production；切换前写入的 Cookie 只可能是 `production`。步骤：

1. 增加 `CAMPUS_WEB_PRODUCTION` binding，`DEFAULT_LANE` 保持 `staging`，用 `?lane=prod` 验收；
2. 在 GitOps 把注入的 `DEFAULT_LANE` 改为 `production`，随 router 新版本发布；
3. 回滚时恢复 `DEFAULT_LANE=staging`。

## 发布

production 建立前 router 以 `edge-router-staging` 登记在 `scripts/release/workers.mts`，随 staging 候选链发布，
与其他 Worker 一样单一版本承接 100% 流量。GitOps 注入 `DEFAULT_LANE` 与 `CAMPUS_WEB_STAGING` binding。
`muc.wiki` zone 不在本账号，`chat.muc.wiki` 经 Cloudflare for SaaS 登记为 `mucwiki-edge.link` 的 custom hostname，
router 以 `chat.muc.wiki/*` Worker route 挂载；custom hostname 生效后旧 staging 主机名重定向到该域名。

## 本地验证

```bash
pnpm --dir apps/edge-router typecheck
pnpm --dir apps/edge-router test:unit
pnpm --dir apps/edge-router build
```

单元测试使用伪造的 Service Binding，不证明线上 Worker 路由、静态资源经 Service Binding 的行为或任一环境已经部署。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/runtime-release.md`
- `.agents/notes/proposed/architecture/2026-10-18-shared-domain-environment-lanes.md`
