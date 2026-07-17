---
doc_type: runbook
owner_boundary: apps/app-api
status: active
---

# MUC Wiki 联邦登录操作

## 边界

本文只说明 staging `muc-wiki` federation client 的重复配置步骤。架构和 wire contract 分别见
`../architecture/system/mucwiki-login.md`、`../architecture/system/identity-authz.md` 和
`../contracts/app-api/federation.md`。

## 配置 Client

client secret 是运行 secret，不得写入文档、源码、fixture 或示例。

```bash
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/Special:UserLogout' \
APP_API_SCHEMA_DATABASE_URL='postgresql://<staging-schema-owner-url>' \
APP_API_DATABASE_SSLMODE=require \
pnpm --dir apps/app-api exec tsx ./ops/identity/provision-muc-wiki-federation-client.ts
```

该命令只在可信部署机临时消费 schema owner DSN，将受控 client 写入 Better Auth OAuth provider
table，并由 app-api federation runtime policy 校验。DSN 不进入 GitHub Environment 或仓库文件。

## 验证

配置完成后执行 `e2e.md` 或 MediaWiki 所属 staging smoke。client 行存在只证明配置完成，
不证明生产联邦登录已经可用。
