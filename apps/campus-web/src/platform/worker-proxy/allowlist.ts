export const CAMPUS_ALLOWED_APP_API_PATHS = [
	"/.well-known/openid-configuration",
	"/.well-known/oauth-authorization-server",
	"/api/me",
	"/api/me/profile-memory",
	"/api/me/profile-memory/items",
	"/api/me/profile-memory/settings",
	"/api/auth/sign-in/email",
	"/api/auth/sign-up/email",
	"/api/auth/sign-out",
	"/api/auth/get-session",
	"/api/auth/list-accounts",
	"/api/auth/list-sessions",
	"/api/auth/request-password-reset",
	"/api/auth/reset-password",
	"/api/federation/authorize",
	"/api/federation/token",
	"/api/federation/userinfo",
	"/api/federation/jwks",
	"/api/federation/logout",
	"/api/chat/conversations",
	"/api/chat/conversations/search",
	"/api/chat/requests",
	"/api/chat/requests/stream",
	"/api/docs/readyz",
	"/api/campus-services/transport-schedule/status",
	"/api/campus-map/places",
	"/api/dining/bootstrap",
	"/api/dining/halls",
	"/api/dining/publication",
	"/api/dining/search",
	"/api/feedback",
] as const;

const STATIC_ALLOWED_PATHS = new Set<string>(CAMPUS_ALLOWED_APP_API_PATHS);

export function isAllowedCampusAppApiRequest(pathname: string): boolean {
	if (STATIC_ALLOWED_PATHS.has(pathname)) {
		return true;
	}

	return (
		/^\/api\/chat\/conversations\/[^/]+$/.test(pathname) ||
		/^\/api\/chat\/conversations\/[^/]+\/archive$/.test(pathname) ||
		/^\/api\/chat\/conversations\/[^/]+\/pin$/.test(pathname) ||
		/^\/api\/chat\/conversations\/[^/]+\/messages\/[^/]+\/feedback$/.test(pathname) ||
		/^\/api\/chat\/conversations\/[^/]+\/messages\/[^/]+\/trailing$/.test(pathname) ||
		/^\/api\/chat\/runs\/[^/]+$/.test(pathname) ||
		/^\/api\/chat\/runs\/[^/]+\/events$/.test(pathname) ||
		/^\/api\/chat\/runs\/[^/]+\/events\/stream$/.test(pathname) ||
		/^\/api\/chat\/runs\/[^/]+\/cancel$/.test(pathname) ||
		/^\/api\/me\/profile-memory\/items\/[^/]+$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/navigation$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+\/resolve$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+\/versions$/.test(pathname) ||
		/^\/api\/docs\/collections\/[^/]+\/[^/]+\/documents\/[^/]+\/admission$/.test(pathname) ||
		/^\/api\/campus-map\/places\/[^/]+$/.test(pathname) ||
		/^\/api\/dining\/halls\/[^/]+\/floors\/[^/]+$/.test(pathname) ||
		/^\/api\/dining\/offerings\/[^/]+\/reviews$/.test(pathname)
	);
}
