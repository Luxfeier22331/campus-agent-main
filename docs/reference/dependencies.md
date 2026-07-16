---
doc_type: reference
owner_boundary: repository dependencies
status: active
---
# 依赖覆盖

根 `package.json` 只允许保留有当前安全或兼容证据的 pnpm override。依赖升级消除原因后，必须删除对应 override。

| 依赖范围 | 固定版本 | 原因 | 删除条件 |
| --- | --- | --- | --- |
| `esbuild@<0.25.0` | `0.25.12` | `drizzle-kit -> @esbuild-kit/core-utils` 仍请求 `0.18.20`，受 [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) 影响 | 上游依赖图不再解析到 `<0.25.0` 后删除 |
