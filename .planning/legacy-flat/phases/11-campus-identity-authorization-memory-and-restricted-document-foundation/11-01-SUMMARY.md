# 11-01 Summary

## Outcome

- `ContextProjection` shared seam 现在显式承载 canonical `principal_type` 与 authorization `projection_source`。
- `apps/app-api` 的 public、campus、operator principal path 已能把这两个字段稳定投影到 `app-api -> supervisor-api` transport。
- Python projection builder、shared contracts 与 supervisor admission parser 已对齐新字段，同时保持当前 retrieval filter 兼容形状不变。

## Main Changes

- `packages/contracts/src/campus_contracts/models.py`
  - `ActorContext` 新增 `principal_type`
  - `AuthorizationProjection` 新增 `projection_source`
- `apps/app-api/src/modules/auth/principal.ts`
  - public / campus / operator principal path 现在显式写入 canonical principal class
  - default authorization projection 现在显式标注来源：`public_session`、`campus_identity`、`operator_headers`
- `apps/app-api/src/modules/integration/supervisor.ts`
  - supervisor transport 现在序列化 `principal_type` 与 `projection_source`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
  - parser 现在保留并消费这两个新字段
- `apps/app-api/src/campus_app_api/projection.py`
  - Python-side context projection builder 对齐 principal/authz source semantics
- tests
  - public user 不会被自动升级成 campus entitlement principal
  - trusted campus identity input 会产出 `student` principal 与 `campus_identity` projection source
  - operator path 与 end-user principal 继续显式分离

## Verification

- `pnpm --filter app-api typecheck`
  - pass
- `pnpm --filter app-api test:node -- test/principal-resolution.test.ts test/supervisor-adapter.test.ts test/chat-command.service.test.ts test/chat-conversations.service.test.ts test/operator-query.route.test.ts test/projection.service.test.ts test/official-web-e2e.test.ts test/official-web-query.route.test.ts test/chat-requests.route.test.ts test/chat-conversations.route.test.ts`
  - pass (`20` files, `96` tests)
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.app_api.test_projection tests.contracts.test_models tests.api.test_supervisor_api`
  - pass (`43` tests)
- `git diff --check -- apps/app-api/src/modules/auth/principal.ts apps/app-api/src/modules/auth/index.ts apps/app-api/src/modules/integration/supervisor.ts apps/app-api/src/campus_app_api/projection.py apps/supervisor-api/src/campus_supervisor_api/api.py packages/contracts/src/campus_contracts/models.py apps/app-api/test/principal-resolution.test.ts apps/app-api/test/supervisor-adapter.test.ts apps/app-api/test/chat-command.service.test.ts apps/app-api/test/chat-conversations.service.test.ts apps/app-api/test/operator-query.route.test.ts apps/app-api/test/projection.service.test.ts apps/app-api/test/official-web-e2e.test.ts apps/app-api/test/official-web-query.route.test.ts apps/app-api/test/chat-requests.route.test.ts apps/app-api/test/chat-conversations.route.test.ts tests/app_api/test_projection.py tests/contracts/test_models.py tests/api/test_supervisor_api.py .planning/ROADMAP.md .planning/phases/11-campus-identity-authorization-memory-and-restricted-document-foundation`
  - pass
