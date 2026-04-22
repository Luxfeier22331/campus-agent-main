# public-docs-web

`public-docs-web` 是 `campus-agent` 的独立文档站 Worker surface。

当前这版实现用于验证：

- `TanStack Start + Fumadocs` 是否能作为 repo-native docs shell
- 打包后的 Markdown 文档能否直接进入 docs app
- Cloudflare Worker 目标是否与 Fumadocs 官方集成兼容

## Local Development

```bash
pnpm install
pnpm --filter public-docs-web dev
```

默认本地地址：

- `http://127.0.0.1:5175`

## Verification

```bash
pnpm --filter public-docs-web typecheck
pnpm --filter public-docs-web build
```

## Notes

- 当前接入的是 Fumadocs 官方 `TanStack Start` 路线，没有 fork Fumadocs 包源码。
- 当前文档内容是 repo 内测试 Markdown，用于验证 docs shell、层级导航与 Worker 构建链。
