---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Summary: Phase 04 Account Shell Relocation

## Outcome

The public account browser shell is relocated to hub while app-api remains the
auth backend.

Closed scope:

- Hub owns `/account`, login, registration, password reset request and password
  reset browser routes.
- Hub account forms call app-api Better Auth endpoints through allowlisted
  same-site API seams.
- Turnstile response forwarding is wired through `x-captcha-response`.
- Public-chat auth-family browser routes are bounded compatibility redirects to
  hub account routes with explicit `return_to`.
- App-api readiness separates `authShellOrigin` from public-chat compatibility
  origin.

## Verification

Fresh focused verification:

```bash
pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/worker.test.ts test/auth-and-db.test.ts
pnpm --filter public-chat-web test:worker
```

Result: app-api reported `32 passed`; public-chat worker lane reported
`28 passed` files and `142 passed` tests.

## Residuals

No Phase 4 residual remains. Public-chat compatibility routes should be removed
only through a later explicit deprecation phase.
