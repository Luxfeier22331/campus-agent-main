# hub-web

Retired Cloudflare Worker package.

`apps/hub-web` is kept only as a historical implementation artifact during the
deletion window. It is no longer the product entry, account browser shell, auth
return target, OAuth/OIDC issuer origin, staging deploy gate, or account smoke
target.

Current ownership moved to:

- `apps/campus-web` for student-facing browser shell and `/account/*`
- `apps/app-api` for auth/session/identity/federation truth

Do not add new product work, runbooks, staging smoke requirements, or public
routes to this package. The next cleanup step is deleting the package after
route, secret, and deploy dependencies are confirmed absent.
