# sso-tgc-extractor

这个任务由协作者自己的电脑或 GitHub Actions 运行：使用协作者自己的学校账号通过
Playwright 登录并取得 `SSO_TGC`，再通过 Ops Web 自动化接口按名称同步一条具名凭据。
Ops Web 仍负责真实验证、CAS 刷新、持久化和定时检查；任务不会连接数据库，也不会在集群中运行。
协作者应使用 `MUC-WIKI/sso-tgc-template` 创建独立运行仓库。

## 运行模式

### 仅提取

`--dry-run` 只需要账号和密码，不访问 Ops Web：

```bash
pnpm --dir jobs/sso-tgc-extractor exec tsx src/cli.ts --dry-run
```

标准输出只包含提取时间和是否复用浏览器状态，不包含 TGC 或 Cookie 值。

### 提取并同步

```bash
pnpm --dir jobs/sso-tgc-extractor exec tsx src/cli.ts
```

普通模式要求 `SSO_TGC_EXTRACTOR_AUTOMATION_URL`、
`SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN` 和 `SSO_TGC_EXTRACTOR_CREDENTIAL_NAME`。
运行仓库从 Secrets/Variables 注入这些值。任务先读取凭据 metadata，再按名称匹配目标：首次没有匹配记录时创建一条，已有一条时
使用返回的版本发送 `If-Match` 轮换，多条同名记录会失败。创建或轮换都由 Ops Web 完成真实 TGC 验证和 CAS 写入。

每个 name 对应一条稳定记录。每次成功提取都立即验证并轮换这条记录，不等待旧 TGC 过期，也不为每次运行创建新记录。
候选值验证失败时保留旧值；旧值已经被定时检查标记为失效时，下一次成功提取仍然轮换原记录并恢复检查。

## 协作者侧配置

1. 协作者使用 `MUC-WIKI/sso-tgc-template` 创建一个私有运行仓库。
2. 协作者在 Ops Web 的“开发者自动化访问”区域生成一个独立 token，复制 endpoint 和 Bearer token，并在运行仓库配置
   `SSO_TGC_EXTRACTOR_AUTOMATION_URL`（Actions variable）和
   `SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN`（Actions secret）。每个运行仓库使用独立 token，退役时撤销。
3. 协作者选择一个唯一的凭据名称。首次成功运行会自动创建该名称的记录，后续运行复用同一个记录。
4. 配置以下三个账号相关 Secrets：

| Secret | 说明 |
| --- | --- |
| `SSO_TGC_EXTRACTOR_USERNAME` | 学校账号 |
| `SSO_TGC_EXTRACTOR_PASSWORD` | 学校密码 |
| `SSO_TGC_EXTRACTOR_CREDENTIAL_NAME` | 该协作者使用的唯一凭据名称 |

账号和密码只进入协作者自己的 Action Secret 或本地运行环境。automation token 当前可管理全部具名凭据，必须按运行仓库单独创建，不能在协作者之间共享。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run extract
```

定时触发由协作者自己的 GitHub Actions 或本地计划任务负责。模板默认每 6 小时运行一次；仓库不再提供中央定时
workflow，集群也不再部署 extractor CronJob。多个协作者可以各自运行任务，只要使用不同的具名凭据名称；每个协作者
维护自己的账号、密码、schedule 和失败处理。

不要把真实账号、密码、token 或 TGC 写入 Git、日志、URL、镜像、ConfigMap 或 Kubernetes Secret。
任务的输出只返回模式、`created`/`rotated` 动作、目标凭据标识、旧版本、新版本、提取时间和状态；TGC 不进入输出或错误消息，
仅在当前进程内用于一次 `POST` 创建或 `PUT` 轮换请求。显式设置 `SSO_TGC_EXTRACTOR_STORAGE_STATE_DIR` 时，Playwright
会按该本地选项保存浏览器状态以支持下次复用；该目录已列入忽略规则。

## 环境变量

| 变量 | 轮换模式 | dry-run | 说明 |
| --- | --- | --- | --- |
| `SSO_TGC_EXTRACTOR_USERNAME` | 必填 | 必填 | 学校账号 |
| `SSO_TGC_EXTRACTOR_PASSWORD` | 必填 | 必填 | 学校密码 |
| `SSO_TGC_EXTRACTOR_AUTOMATION_URL` | 必填 | 不需要 | 从 Ops Web“开发者自动化访问”区域复制到运行仓库的 Actions variable |
| `SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN` | 必填 | 不需要 | 从 Ops Web“开发者自动化访问”区域复制到运行仓库的 Actions secret |
| `SSO_TGC_EXTRACTOR_CREDENTIAL_NAME` | 必填 | 不需要 | 协作者唯一的具名凭据名称；首次运行自动创建 |
| `SSO_TGC_EXTRACTOR_LOGIN_URL` | 可选 | 可选 | 默认 CAS 登录地址 |
| `SSO_TGC_EXTRACTOR_PORTAL_URL` | 可选 | 可选 | 默认门户地址 |
| `SSO_TGC_EXTRACTOR_COOKIE_NAME` | 可选 | 可选 | 默认 `SSO_TGC` |
| `SSO_TGC_EXTRACTOR_HEADED` | 可选 | 可选 | 检测验证码时使用有头浏览器 |
| `SSO_TGC_EXTRACTOR_RETRY_TIMES` | 可选 | 可选 | 默认 3 |
| `SSO_TGC_EXTRACTOR_RETRY_DELAY` | 可选 | 可选 | 默认 5000 毫秒 |
| `SSO_TGC_EXTRACTOR_STORAGE_STATE_DIR` | 可选 | 可选 | 未跟踪的浏览器状态目录 |

缺少同步配置不会自动变成 dry-run；任务会在启动 Playwright 前失败。

## 数据流

```text
协作者自己的电脑 / GitHub Actions
  │
  ├─ 学校账号登录 CAS，提取 SSO_TGC（仅进程内）
  │
  └─ GET metadata → (首次 POST 创建 / 后续 PUT ssoTgc + If-Match)
       │
       ▼
Ops Web 自动化 API → 真实 CAS/门户验证 → PostgreSQL 具名凭据
       │
       ▼
ops-web-internal-portal-check（现有每 30 分钟检查）
```

Ops Web 更新不会自动修改 `source-collector` 的环境变量。source-collector 仍只消费开发者显式
提供的 `INTERNAL_PORTAL_SSO_TGC`，不读取 Ops Web 凭据表或自动化 token。

## 验证

```bash
pnpm --dir jobs/sso-tgc-extractor typecheck
pnpm --dir jobs/sso-tgc-extractor test
```

首次运行前安装 Playwright 浏览器：

```bash
pnpm --dir jobs/sso-tgc-extractor exec playwright install chromium
```
