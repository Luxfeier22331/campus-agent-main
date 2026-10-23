# Agent Note: Staging 与 production 共用 chat.muc.wiki 并按泳道分发

Status: implemented

## 背景

产品入口迁到 `chat.muc.wiki`。staging 需要直接邀请外部用户体验，production 尚未建立。
目标是两个环境共用这一个主机名，通过泳道选择访问哪个环境，而不是为 staging 另配主机名。
`staging.chat.muc.wiki` 这类四级主机名不在 Universal SSL 的 `*.muc.wiki` 覆盖范围内，不作为方案。

此前每个环境的 `campus-web` 直接挂自己的域名，经 Service Binding 调用同环境 `app-api`，再连接各自的
Hyperdrive、VPC Service 和 Kubernetes namespace；Cloudflare Terraform 与 Kargo 按环境管理域名和流量版本，
见[运行时发布架构](../../../../docs/architecture/system/runtime-release.md)。Workers 路由只按主机名和路径
匹配，不能按 Cookie 选择 Worker。两个环境共用一个浏览器 origin 后，还会在以下位置互相影响：

- Better Auth 使用默认 Cookie 名（`auth-config.ts` 未设置 `cookiePrefix`），切换环境会覆盖另一环境的会话；
- Campus Web 公共边缘缓存以请求 URL 作为 Cache API key（`public-cache.ts`），同一 URL 的两个环境响应会互相覆盖；
- App API 的公开接口允许浏览器缓存（如 `/api/dining` 为 `max-age=60, stale-while-revalidate=86400`，菜单与班车为
  `max-age=30`），切换环境后浏览器可能继续使用另一环境的响应；
- 验证与重置邮件链接只由 `AUTH_SHELL_ORIGIN` 拼出，在没有泳道 Cookie 的设备上打开会进入默认环境；
- [Federation 合同](../../../../docs/contracts/app-api/federation.md)要求 metadata host 与部署 origin 一致，
  两个环境的 issuer 不能同时落在同一 origin。

## 决策

### 边缘路由

`apps/edge-router` Worker 以 Worker route 挂载 `chat.muc.wiki/*`，作为该主机名唯一的 Worker，
通过 fetch 形式的 Service Binding 把请求转给目标环境的 `campus-web`。各环境 `campus-web` 不自行挂载该域名，
下游 `app-api` 和集群链路不变。两个环境从 Worker 到数据库、集群都是独立部署，只需要在入口选择一次环境，
泳道标记不向下游服务传播。

```text
chat.muc.wiki/*  ->  edge-router
                       ├─ 无泳道或泳道无效 -> 默认环境 campus-web
                       └─ lane=staging     -> campus-web-staging
```

router 只做泳道判定、Cookie 隔离和转发，不读取产品数据、不鉴权、不缓存响应。

`muc.wiki` zone 在另一个 Cloudflare 账号，Workers Custom Domain 要求 zone 与 Worker 同账号，因此用 Cloudflare
for SaaS 接入：`mucwiki-edge.link` zone 以 `saas-fallback.mucwiki-edge.link` 为 fallback origin，把 `chat.muc.wiki`
登记为 custom hostname（Cloudflare 签发 DV 证书，TXT 验证），再在该 zone 上挂载 `chat.muc.wiki/*` Worker route。
`muc.wiki` 的 owner 只维护 DNS only 的 `chat` CNAME 与首次签发所需的 TXT 记录。Free 套餐包含 100 个 custom
hostname，足够当前用途。custom hostname 与证书生效后才把 Campus 公开 origin 改为 `https://chat.muc.wiki`，
旧 `campus-staging.mucwiki-edge.link` 301 到它，邮件与认证链接不会先指向尚未生效的域名。

- 默认环境由 router 配置决定。production 建立前默认环境是 staging；production 上线时只把默认目标改为
  production。
- 页面导航请求（`Sec-Fetch-Mode: navigate`）带 `?lane=staging|prod` 且目标不是当前泳道时，router 切换泳道并
  去掉参数重定向：选择默认环境清除 `__Host-campus_lane`，选择其他环境写入该 Cookie（HttpOnly、Secure、
  SameSite=Lax、Path=/、不设 Domain，有效期取浏览器上限 400 天）。已在目标泳道时去掉参数直接转发，不重定向、
  不清缓存。只接受白名单内的值，其他值和非导航请求上的参数忽略，嵌入的图片或脚本地址不能切换用户的环境。
  `__Host-` 前缀使浏览器拒绝 `muc.wiki` 其他子域名写入或覆盖该 Cookie。
- 切换泳道的重定向响应带 `Clear-Site-Data: "cache"`，清除本 origin 的浏览器 HTTP 缓存，避免切换后继续使用
  另一环境缓存的公开响应。不使用 `Vary: Cookie`：请求通常带登录 Cookie，按 Cookie 区分会使这些接口基本失去缓存。
- 泳道 Cookie 只表达路由偏好，不是凭据。staging 不做访问控制，伪造它只会进入一个本来公开的环境。
- 转发前剥离另一环境的 Better Auth Cookie 和泳道 Cookie，使任一环境的后端都收不到另一环境的会话。Better Auth
  在 HTTPS 下为 Cookie 名加 `__Secure-` 前缀，剥离按 `__Secure-<环境前缀>.` 和 `<环境前缀>.` 两种形式匹配。
- OIDC 按泳道各有固定 issuer：production 为 `https://chat.muc.wiki`，staging 为
  `https://chat.muc.wiki/lanes/staging`（见下文「OIDC」）。

浏览器里永远不存在默认环境的泳道 Cookie。production 建立前默认环境是 staging，router 不会写入 staging Cookie；
把默认目标改为 production 时，所有未主动选择的用户随之进入 production，相当于对泳道 Cookie 做一次集体失效，
不需要额外的版本号或失效机制。切换前只可能存在测试人员用 `?lane=prod` 写入的 `production` Cookie，切换后它
与默认目标一致。staging 的账号和数据不迁移；切换后，staging 用户通过 `?lane=staging` 或 staging 发出的邮件
链接回到 staging，此后由 Cookie 保持。

### OIDC

两个环境共用主机名后，issuer 不能再由 origin 区分。每个泳道使用固定 issuer，不跟随默认环境：若 issuer 跟随
默认环境，production 上线时 staging 的 issuer 会改变，已接入的 relying party 全部失效。

- production issuer 为根地址，staging 为 `/lanes/staging` 路径 issuer；App API 通过 Better Auth `jwt.issuer`
  设置，metadata 与 id_token `iss` 同源。
- discovery 与 token、userinfo、JWKS 由 relying party 服务端调用，不带泳道 Cookie。router 按 issuer 路径选择
  泳道：`/lanes/<lane>/...` 与 RFC 8414 的 `/.well-known/oauth-authorization-server/lanes/<lane>` 去掉前缀后转发；
  不带前缀的路径只属于 production，production 未部署时返回 `dependency_not_ready`。
- authorize 与 end-session 是浏览器导航，metadata 中带 `?lane=<泳道>`。router 复用泳道切换把用户带到签发
  环境，随后的登录页、consent 页和 consent POST 随 Cookie 留在同一环境，OAuth 参数在重定向中原样保留。
  仅用 Cookie 路由 authorize 时，在 staging 泳道登录 production 的 relying party 会由 production 授权、
  由 staging 登录，production 看不到会话而反复跳转。
- 不为浏览器 endpoint 使用路径前缀：登录与 consent 页面使用根路径，路径前缀无法覆盖整个授权流程。

### 应用改动

泳道名、`?lane=` 查询值、泳道 Cookie 名和各泳道的 Better Auth Cookie 前缀集中在
`campus-contracts/environment-lanes`，router、App API 和 Campus Web 使用同一份映射。

- `app-api` 为 staging 和 production 分别设置 Better Auth `advanced.cookiePrefix`（`campus-staging`、
  `campus-production`）；development 与 test 不共用主机名，保留默认前缀。router 按这些前缀识别和剥离 Cookie。
  staging 改前缀后，现有 staging 会话需要重新登录一次。
- `campus-web` 从 `DEPLOYMENT_ENVIRONMENT` 读取所属泳道，公共缓存 key 以 `/__campus-lane/<泳道>` 为路径前缀。
  GitOps 已为每个 Worker 注入该变量，不新增环境配置。
- `app-api` 在密码重置、邮箱验证、更换邮箱、访问邀请和认证反馈链接中带上本环境的 `lane=<查询值>`。每个部署
  环境总是带自己的泳道，不需要知道当前默认环境；staging 发出的邀请链接因此直接把受邀者带进 staging。
- 两个环境的 `AUTH_SHELL_ORIGIN` 都设为 `https://chat.muc.wiki`。
- staging 的 Campus Web 在品牌旁显示体验版标识，是否显示由运行时注入的部署泳道决定，不读取泳道 Cookie；
  Docs 等未注入运行时配置的静态页面不显示。production 建立前没有可退出的目标，界面上的退出入口在 production
  泳道建立时再加入；退出机制本身已由 router 提供。
- status-web 的 Campus 探测默认覆盖默认环境；需要探测 staging 时，请求带 `__Host-campus_lane=staging` Cookie。

### 发布所有权

production 建立前只有 staging 环境仓，router 以 `edge-router-staging` 加入现有 Worker 候选链：源码仓在
`scripts/release/workers.mts` 登记并构建 bundle，GitOps 注入 `DEFAULT_LANE` 与 `CAMPUS_WEB_STAGING` binding，
platform root 管理 SaaS fallback 与 custom hostname，traffic root 创建 `chat.muc.wiki/*` Worker route。
新增 router 前发布的候选不含它，两边读取已发布候选时只要求其发布时的 Worker 集合，新组装的候选必须包含 router。

现有 GitOps 只允许单一版本承接 100% 流量，router 与其他 Worker 一样按此发布，不使用渐进式部署或版本覆盖；
回滚即重新选择上一版本。router 的变更直接影响所有环境，按 production 标准评审；逻辑保持在上述判定、隔离和
转发之内。production 建立时重新评估 router 的名称、所属环境仓与发布方式。

域名所有权与浏览器路径的现行描述见[运行时发布架构](../../../../docs/architecture/system/runtime-release.md)和
[产品运行时](../../../../docs/architecture/system/product-runtime.md)。

## 未采用方案

- **为 staging 使用独立主机名（如 `chat-staging.muc.wiki`）。** Cookie、缓存和 OIDC issuer 天然按主机名隔离，
  不需要 router 及上述应用改动，成本最低。不采用，因为目标就是两个环境共用 `chat.muc.wiki`。
- **四级主机名 `staging.chat.muc.wiki`。** 在命名上最清楚，但 Universal SSL 不覆盖，需要额外的证书产品。
- **仅用 Worker version override 做泳道。** 平台原生，也不需要 router，但只能在同一环境的 Worker 版本之间切换。
  staging 有独立的数据库、账号和集群，版本覆盖无法把请求送到另一套数据。
- **用 Cloudflare Access 保护 staging 泳道。** 可以防止普通用户误入，并减少团队成员 production 会话与预发代码
  同处一个 origin 的暴露。不采用，因为 staging 需要直接邀请外部用户，加认证会阻断这一用途。
- **路径前缀（如 `/staging/*`）。** 不依赖 Cookie，但 Campus Web 和 App API 使用根路径和绝对路径，资源、路由、
  认证回调和 Cookie Path 都要改写，涉及面大于 router。
- **用 Snippets 代替 router Worker。** 不新增 Worker 部署单元，但 Snippets 需要 Pro 以上套餐，单次执行上限 5 ms，
  且没有 Service Binding，无法直接把请求交给另一环境的 Worker。

## 后果

- 访问 `chat.muc.wiki` 无泳道时进入默认环境；`?lane=staging` 后后续请求进入 staging，`?lane=prod` 写入
  production Cookie，production 未部署时仍由默认环境服务；非导航请求上的 `?lane=` 不改变泳道。
- 两个环境可在同一浏览器中各自保持登录，转发到任一环境的请求不含另一环境的 Better Auth Cookie；同一公开 URL
  在两个环境的边缘缓存互不覆盖。
- staging 发出的验证、重置和邀请链接在没有泳道 Cookie 的浏览器中仍完成于 staging；文档和测试指向 staging
  页面时同样带 `?lane=staging`，不依赖当前默认泳道。
- production 上线只修改 router 的默认目标，所有未主动选择 staging 的用户进入 production。
- router 是两个环境共用的单点，无法先在 staging 验证再晋级；router 故障会同时中断两个环境。现有发布流程
  一次切换 100% 流量，只能靠评审和单元测试降低风险。
- 静态资源请求原本免费，经过 router 后每个都计一次 Worker 请求。Service Binding 不另计请求费，CPU 时间按两个
  Worker 合计；按官方文档，Service Binding 默认在同一线程执行，不增加延迟。按当前流量，额外费用可以忽略。
- 官方文档未说明经 Service Binding 进入带静态资源的 Worker 时，`run_worker_first` 的排除规则是否生效、资源是否
  仍直接由资源层返回；router 单元测试使用伪造 binding，同样不覆盖这一点。若不生效，静态资源会经过 `campus-web`
  的 Worker 代码，行为和计费都会改变。
- `Clear-Site-Data: "cache"` 清除的是整个 origin 的浏览器缓存，包括带 hash 的静态资源，切换后首次加载需要重新下载。
- staging 不做访问控制，所有人都可进入。团队成员在 staging 泳道时，production 会话 Cookie 仍在同一 origin 下：
  页面脚本读不到 HttpOnly Cookie，router 也会剥离它，但两个环境不再有浏览器 origin 级隔离。若 production
  出现需要更强隔离的数据，须重新评估本方案或改用独立主机名。
- staging 与 production 的账号和对话各自独立，production 上线后不会自动迁移；需要迁移时另行提出。
- 登录另一泳道的 relying party 会切换用户当前泳道，并保持到用户再次切换；体验版标识是唯一提示。
- 少数 relying party 库对带路径的 issuer 处理不完整，接入 staging 时须实测 discovery 与 `iss` 校验。
- `/lanes/` 路径由 router 保留，Campus Web 不能使用该前缀；issuer 发布后不可再改。
