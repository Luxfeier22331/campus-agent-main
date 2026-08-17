import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "../auth/turnstile-runtime-config";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "../runtime/config";
import { fetchStaticAsset, rewriteRequestPathname } from "./assets";
import type { CampusWorkerEnv } from "./env";
import { responseWithSecurityHeaders, SECURITY_HEADERS } from "./response-policy";

const SHELL_PATH_PREFIXES = ["/c/", "/notices/"] as const;
const SHELL_EXACT_PATHS = new Set([
	"/",
	"/map",
	"/dining",
	"/groups",
	"/feedback",
	"/notices",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-link-sent",
	"/account/reset-password",
	"/account/reset-complete",
	"/account/verify-email",
	"/account/verify-email/result",
	"/account/change-password",
	"/account/deletion",
	"/account/settings/account",
	"/account/settings/security",
	"/account/settings/memory",
	"/account/federation/consent",
	"/account/federation/error",
	"/legal/terms",
	"/legal/privacy",
]);

export function isCampusShellPath(pathname: string): boolean {
	if (SHELL_EXACT_PATHS.has(pathname)) {
		return true;
	}
	return SHELL_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get("accept") ?? "";
	return accept.includes("text/html") || accept.includes("*/*");
}

export async function serveCampusShell(request: Request, env: CampusWorkerEnv): Promise<Response> {
	const assetRequest = rewriteRequestPathname(request, "/index.html", request.method);
	const response = await fetchStaticAsset(assetRequest, env);
	if (response.status === 503) {
		return response;
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("text/html")) {
		return responseWithSecurityHeaders(response);
	}
	if (request.method === "HEAD") {
		return new Response(null, {
			headers: campusHtmlHeaders(response, { cacheControl: "no-store" }),
			status: response.status,
			statusText: response.statusText,
		});
	}
	return campusHtmlResponse(response, request, env, { cacheControl: "no-store" });
}

function injectCampusRuntimeConfig(html: string, request: Request, env: CampusWorkerEnv): string {
	const campusOrigin = new URL(request.url).origin;
	const serializedConfig = JSON.stringify({
		accountUrl: new URL("/account", campusOrigin).toString(),
		loginUrl: new URL("/account/login", campusOrigin).toString(),
		sentry: {
			dsn: env.SENTRY_DSN?.trim() || null,
			environment: env.DEPLOYMENT_ENVIRONMENT?.trim() || null,
			release: env.DEPLOYMENT_RELEASE?.trim() || null,
		},
	}).replace(/</g, "\\u003c");
	const authRuntimeConfig = JSON.stringify(
		resolveTurnstileRuntimeConfig({
			turnstileSiteKey: env.AUTH_TURNSTILE_SITE_KEY,
		}),
	).replace(/</g, "\\u003c");
	const scriptTag = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${serializedConfig}</script><script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${authRuntimeConfig}</script>`;

	if (html.includes(`id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		return html;
	}

	if (html.includes("</body>")) {
		return html.replace("</body>", `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
}

async function campusHtmlResponse(
	response: Response,
	request: Request,
	env: CampusWorkerEnv,
	input: { cacheControl?: string } = {},
): Promise<Response> {
	const headers = campusHtmlHeaders(response, input);
	return new Response(injectCampusRuntimeConfig(await response.text(), request, env), {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function campusHtmlHeaders(response: Response, input: { cacheControl?: string } = {}): Headers {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	if (input.cacheControl) {
		headers.set("cache-control", input.cacheControl);
	}
	for (const staleHeader of [
		"content-digest",
		"content-encoding",
		"content-length",
		"content-md5",
		"etag",
		"last-modified",
	]) {
		headers.delete(staleHeader);
	}
	return headers;
}
