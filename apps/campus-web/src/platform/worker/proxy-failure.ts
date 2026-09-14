import { dependencyNotReadyResponse } from "./response-policy";

export type ProxyFailure =
	| "missing_config"
	| "missing_binding"
	| "transport_failure"
	| "invalid_upstream_response";

export function proxyFailureResponse(request: Request, failure: ProxyFailure): Response {
	const pathname = new URL(request.url).pathname;
	const route = pathname.startsWith("/api/auth/")
		? "/api/auth/*"
		: pathname.startsWith("/api/federation/")
			? "/api/federation/*"
			: pathname.startsWith("/.well-known/")
				? "/.well-known/*"
				: "/api/*";
	const ray = request.headers.get("cf-ray");
	console.error({
		error_code: "app_api_proxy_failed",
		source: "campus-web.app-api-proxy",
		failure_class: failure,
		route,
		cf_ray: ray && /^[a-zA-Z0-9-]{1,64}$/.test(ray) ? ray : null,
	});
	return dependencyNotReadyResponse();
}
