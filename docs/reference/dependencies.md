---
doc_type: reference
owner_boundary: repository dependencies
status: active
---
# 依赖覆盖

根 `package.json` 只允许保留有当前安全或兼容证据的 pnpm override。依赖升级消除原因后，必须删除对应 override。

| 依赖范围 | 固定版本 | 原因 | 删除条件 |
| --- | --- | --- | --- |
| `brace-expansion@>=5.0.0 <5.0.8` | `5.0.8` | 修复 [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) 的无界展开问题 | 上游依赖图不再解析到 `<5.0.8` 后删除 |
| `@assistant-ui/react-markdown` | `0.14.7` | `0.14.10` 要求 `@assistant-ui/react@^0.15.0`，当前应用仍使用 `0.14.29` | `@assistant-ui/react` 与 Markdown 包完成 0.15 版本组升级后删除 |
| `esbuild@<0.25.0` | `0.25.12` | `drizzle-kit -> @esbuild-kit/core-utils` 仍请求 `0.18.20`，受 [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) 影响 | 上游依赖图不再解析到 `<0.25.0` 后删除 |
| `minimatch@>=5.0.0 <10.2.5` | `10.2.5` | Testcontainers 和 `glob@10` 的依赖范围仍解析到使用脆弱 `brace-expansion` 的 v5/v9；仓库仅消费 v10 保留的命名 API | 上游依赖图全部声明 `minimatch@>=10.2.5` 后删除 |
