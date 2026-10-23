import { buildAvailabilitySnapshot, markExpiredSnapshot } from "./status/aggregate";
import {
	missingStatusRuntimeConfig,
	resolveStatusEnvironment,
	resolveStatusOrigin,
	resolveStatusRuntimeConfig,
	STATUS_SERVICE_DEFINITIONS,
	serviceProbes,
} from "./status/config";
import {
	type CampusHtmlParser,
	type ProbeFetch,
	parseCampusHtmlWithHtmlRewriter,
	runProbe,
} from "./status/probes";
import {
	createKvSnapshotStore,
	createMemorySnapshotStore,
	type SnapshotNamespace,
} from "./status/store";
import type { StatusStore } from "./status/types";

export interface AssetFetcher {
	fetch(request: Request): Promise<Response> | Response;
}

export interface Env {
	ASSETS?: AssetFetcher;
	DEPLOYMENT_ENVIRONMENT?: string;
	CAMPUS_WEB_PUBLIC_ORIGIN?: string;
	STATUS_CAMPUS_ORIGIN?: string;
	STATUS_QA_ORIGIN?: string;
	STATUS_SNAPSHOT?: SnapshotNamespace;
}

export interface StatusWorkerDependencies {
	fetchFn?: ProbeFetch;
	htmlParser?: CampusHtmlParser;
	store?: StatusStore;
	now?: () => Date;
}

const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-content-type-options": "nosniff",
} as const;
const STATUS_BROWSER_CACHE_SECONDS = 30;
const STATUS_CDN_CACHE_SECONDS = 60;
const CAMPUS_NAV_REDIRECTS = new Map([
	["/go/campus/", "/"],
	["/go/campus/docs", "/docs"],
	["/go/campus/map", "/map"],
	["/go/campus/dining", "/dining"],
	["/go/campus/groups", "/groups"],
	["/go/campus/feedback", "/feedback"],
]);

const localStore = createMemorySnapshotStore();

export function createStatusWorker(dependencies: StatusWorkerDependencies = {}) {
	const now = dependencies.now ?? (() => new Date());
	const fetchFn = dependencies.fetchFn ?? globalThis.fetch;

	return {
		async fetch(request: Request, env: Env): Promise<Response> {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/healthz") {
				return jsonResponse(200, {
					app_name: "campus-agent-status-web",
					runtime: "cloudflare-worker",
					status: "ok",
					surface: "product-availability-status",
				});
			}
			if (request.method === "GET" && url.pathname === "/readyz") {
				const missing = missingStatusRuntimeConfig(env);
				return missing.length > 0
					? jsonResponse(503, {
							error: {
								code: "dependency_not_ready",
								details: { missing },
								message: "状态服务暂未准备好。",
							},
						})
					: jsonResponse(200, { status: "ready" });
			}
			if (
				(request.method === "GET" || request.method === "HEAD") &&
				CAMPUS_NAV_REDIRECTS.has(url.pathname)
			) {
				if (url.search) {
					return jsonResponse(404, {
						error: { code: "not_found", message: "入口不存在。" },
					});
				}
				return redirectToCampusWeb(env, CAMPUS_NAV_REDIRECTS.get(url.pathname) ?? "/");
			}
			if (
				url.pathname === "/api/status" &&
				(request.method === "GET" || request.method === "HEAD")
			) {
				try {
					return serveStatus(
						request,
						now(),
						resolveStatusRuntimeConfig(env),
						dependencies.store ?? resolveStore(env),
					);
				} catch {
					return jsonResponse(503, {
						error: {
							code: "status_snapshot_unavailable",
							message: "状态数据暂时不可用。",
						},
					});
				}
			}
			if (url.pathname.startsWith("/api/")) {
				return jsonResponse(404, {
					error: { code: "not_found", message: "接口不存在。" },
				});
			}
			if ((request.method === "GET" || request.method === "HEAD") && env.ASSETS) {
				const response = await env.ASSETS.fetch(request);
				return withSecurityHeaders(response);
			}
			return jsonResponse(503, {
				error: {
					code: "frontend_assets_unavailable",
					message: "状态页面暂时无法打开。",
				},
			});
		},
		async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
			const config = resolveStatusRuntimeConfig(env);
			const store = dependencies.store ?? resolveStore(env);
			await runStatusCycle({
				config,
				fetchFn,
				htmlParser: dependencies.htmlParser ?? parseCampusHtmlWithHtmlRewriter,
				now: now(),
				store,
			});
		},
	};
}

function redirectToCampusWeb(env: Env, pathname: string): Response {
	let environment: ReturnType<typeof resolveStatusEnvironment> | null;
	try {
		environment = resolveStatusEnvironment(env.DEPLOYMENT_ENVIRONMENT);
	} catch {
		environment = null;
	}
	const origin = environment
		? resolveStatusOrigin(env.CAMPUS_WEB_PUBLIC_ORIGIN, environment)
		: null;
	if (!origin) {
		return jsonResponse(503, {
			error: {
				code: "dependency_not_ready",
				details: { missing: ["CAMPUS_WEB_PUBLIC_ORIGIN"] },
				message: "校园服务入口暂不可用。",
			},
		});
	}
	return new Response(null, {
		headers: {
			"cache-control": "no-store",
			location: new URL(pathname, origin).toString(),
			...SECURITY_HEADERS,
		},
		status: 302,
	});
}

export async function runStatusCycle(input: {
	config: ReturnType<typeof resolveStatusRuntimeConfig>;
	fetchFn?: ProbeFetch;
	htmlParser?: CampusHtmlParser;
	now?: Date;
	store: StatusStore;
}) {
	const now = input.now ?? new Date();
	const observations = await Promise.all(
		STATUS_SERVICE_DEFINITIONS.flatMap((definition) =>
			serviceProbes(definition).map((probe) =>
				runProbe(probe, probe.origin === "qa" ? input.config.qaOrigin : input.config.campusOrigin, {
					...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
					...(input.htmlParser ? { htmlParser: input.htmlParser } : {}),
					now,
				}),
			),
		),
	);
	const snapshot = buildAvailabilitySnapshot({
		config: input.config,
		definitions: STATUS_SERVICE_DEFINITIONS,
		observations,
		now,
		previous: await input.store.read(),
	});
	await input.store.write(snapshot);
	return { observations, snapshot };
}

async function serveStatus(
	request: Request,
	now: Date,
	config: ReturnType<typeof resolveStatusRuntimeConfig>,
	store: StatusStore,
): Promise<Response> {
	try {
		const stored = await store.read();
		if (stored && stored.environment !== config.environment) {
			throw new Error("Stored status snapshot belongs to another environment.");
		}
		if (!stored) {
			return withSecurityHeaders(
				new Response(null, {
					headers: { "cache-control": "no-store" },
					status: 204,
				}),
			);
		}
		const snapshot = markExpiredSnapshot(stored, now);
		const body = JSON.stringify(snapshot);
		const etag = `"${snapshot.generatedAt}:${snapshot.services.map((service) => service.status).join(",")}"`;
		const cacheControl = statusCacheControl(snapshot.expiresAt, now);
		if (request.headers.get("if-none-match") === etag) {
			return withSecurityHeaders(
				new Response(null, {
					headers: { "cache-control": cacheControl, etag },
					status: 304,
				}),
			);
		}
		const headers = new Headers({
			"cache-control": cacheControl,
			"content-type": "application/json; charset=utf-8",
			etag,
		});
		return withSecurityHeaders(
			new Response(request.method === "HEAD" ? null : body, { headers, status: 200 }),
		);
	} catch {
		return jsonResponse(503, {
			error: {
				code: "status_snapshot_unavailable",
				message: "状态数据暂时不可用。",
			},
		});
	}
}

export function statusCacheControl(expiresAt: string, now: Date): string {
	const expiresAtMs = new Date(expiresAt).getTime();
	const nowMs = now.getTime();
	if (!(Number.isFinite(expiresAtMs) && Number.isFinite(nowMs))) {
		return "no-store";
	}
	const remainingSeconds = Math.floor((expiresAtMs - nowMs) / 1000);
	if (remainingSeconds <= 0) {
		return "no-store";
	}
	return `public, max-age=${Math.min(STATUS_BROWSER_CACHE_SECONDS, remainingSeconds)}, s-maxage=${Math.min(STATUS_CDN_CACHE_SECONDS, remainingSeconds)}, must-revalidate`;
}

function resolveStore(env: Env): StatusStore {
	if (env.STATUS_SNAPSHOT) {
		return createKvSnapshotStore(env.STATUS_SNAPSHOT);
	}
	if (resolveStatusEnvironment(env.DEPLOYMENT_ENVIRONMENT) === "development") {
		return localStore;
	}
	throw new Error("STATUS_SNAPSHOT binding is required outside development.");
}

function jsonResponse(status: number, payload: unknown): Response {
	return withSecurityHeaders(
		new Response(JSON.stringify(payload), {
			headers: {
				"cache-control": "no-store",
				"content-type": "application/json; charset=utf-8",
			},
			status,
		}),
	);
}

function withSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

const worker = createStatusWorker();

export default worker;
