import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import type {
	SupervisorExecutionInput,
	SupervisorExecutionResponse,
} from "../../app-api/src/modules/integration";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	type FinalizeRequestWrite,
	type SupervisorExecutionClient,
} from "../../app-api/test/chat-command.service.test-support";
import packageManifestRaw from "../package.json?raw";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

type CampusServicesTool =
	| "contact_directory_lookup"
	| "service_guide_lookup"
	| "service_status_lookup"
	| "transport_schedule_lookup";

interface CampusServicesRoutingCase {
	expectedAnswerFragment: string;
	expectedTool: CampusServicesTool;
	prompt: string;
	toolResult: Record<string, unknown>;
}

const CAMPUS_SERVICES_ROUTING_CASES: CampusServicesRoutingCase[] = [
	{
		expectedAnswerFragment: "丰台校区北门",
		expectedTool: "service_status_lookup",
		prompt: "丰台校区通勤班车在哪里上车",
		toolResult: {
			subject_query: "丰台校区通勤班车在哪里上车",
			outcome: "resolved_current",
			resolved_subject: "丰台校区通勤班车乘车点",
			observed_status: "limited_service",
			status_note: "当前乘车点为丰台校区北门外班车候车点。",
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-03-18T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
			override_source_refs: ["authenticated_notice:355122"],
			related_notice_refs: ["authenticated_notice:355122"],
		},
	},
	{
		expectedAnswerFragment: "07:30",
		expectedTool: "transport_schedule_lookup",
		prompt: "2月24日丰台回海淀最早的班车是几点",
		toolResult: {
			query_text: "2月24日丰台回海淀最早的班车是几点",
			intent: "first_departure",
			outcome: "resolved_current",
			resolved_route: {
				route_id: "transport:intercampus:fengtai-to-haidian",
				display_name: "丰台至海淀通勤班车",
				service_family: "intercampus_commute",
			},
			service_status: "running",
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			requested_service_date: "2026-02-24",
			selected_departure: {
				departure_at: "2026-02-24T07:30:00+08:00",
				origin_stop_ref: {
					stop_id: "stop:fengtai:north-gate",
					display_name: "丰台校区北门",
				},
				destination_stop_ref: {
					stop_id: "stop:haidian:east-gate",
					display_name: "海淀校区东门",
				},
			},
			related_notice_refs: ["authenticated_notice:354777"],
		},
	},
	{
		expectedAnswerFragment: "预约入口",
		expectedTool: "service_guide_lookup",
		prompt: "地铁接驳车怎么预约",
		toolResult: {
			service_query: "地铁接驳车怎么预约",
			guide_focus: "entry",
			outcome: "resolved_current",
			resolved_service: {
				service_id: "service:transport:metro-shuttle-reservation",
				display_name: "地铁接驳车预约",
				aliases: ["地铁接驳车", "接驳车预约"],
				category: "transport",
				campus_scope: "fengtai",
				audience: ["student", "faculty"],
			},
			guide_sections: [
				{
					section_type: "entry",
					title: "预约入口",
					content: "通过学校统一预约入口提交地铁接驳车预约。",
					source_refs: ["authenticated_notice:354777"],
				},
			],
			entry_refs: [
				{
					label: "统一预约入口",
					entry_type: "instructions_only",
					source_refs: ["authenticated_notice:354777"],
				},
			],
			source_refs: ["authenticated_notice:354777"],
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-02-27T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
			matched_service_category: "transport",
		},
	},
	{
		expectedAnswerFragment: "010-68930001",
		expectedTool: "contact_directory_lookup",
		prompt: "研究生院办公室电话是多少",
		toolResult: {
			query_text: "研究生院办公室电话是多少",
			contact_focus: "phone",
			outcome: "resolved_current",
			resolved_contact: {
				contact_id: "contact:graduate-school:office",
				display_name: "研究生院办公室",
				entity_type: "office",
			},
			contact_points: [
				{
					label: "办公室电话",
					contact_type: "phone",
					value: "010-68930001",
					source_refs: ["official_web:graduate-school:contact"],
				},
			],
			location_refs: [
				{
					label: "办公地点",
					location_ref: "海淀校区研究生院",
					source_refs: ["official_web:graduate-school:contact"],
				},
			],
			source_refs: ["official_web:graduate-school:contact"],
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-04-01T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
		},
	},
];

function findCampusServicesRoutingCase(prompt: string): CampusServicesRoutingCase {
	const route = CAMPUS_SERVICES_ROUTING_CASES.find((item) => item.prompt === prompt);
	if (!route) {
		throw new Error(`Unexpected campus-services routing prompt: ${prompt}`);
	}
	return route;
}

function buildCampusServicesExecutionResponse(
	input: SupervisorExecutionInput,
	route: CampusServicesRoutingCase,
): SupervisorExecutionResponse {
	return {
		answerText:
			"debug projection_internal_state release_id=campus_services_release authenticated_notice:355122 official_web:graduate-school:contact",
		error: null,
		followUpQuestion: "",
		observability: {
			aclAnomalyCode: null,
			aclDecision: null,
			cachedInputTokens: null,
			candidateCount: 1,
			citationCount: null,
			citationExpected: null,
			citationMissing: null,
			estimatedCostMicrousd: null,
			failClosed: false,
			inputTokens: null,
			intentCapability: "campus_services",
			intentNextAction: "delegate",
			intentResolvedSlots: {
				allowed_tool: route.expectedTool,
				payload_kind: route.expectedTool,
			},
			intentRoutingConfidence: "high",
			intentScopeClass: "in_scope",
			intentTaskKind: "campus_services_lookup",
			modelName: null,
			modelProvider: null,
			outputTokens: null,
			refusalClass: null,
			retrievedSourceCount: null,
			retrievalAttempted: false,
			semanticOutcome: "resolved_current",
		},
		result: {
			allowed_tools: [route.expectedTool],
			payload_kind: route.expectedTool,
			target: "campus-services-agent",
			tool_result: route.toolResult,
			diagnostics: {
				grounding_verdict: "supported",
				retrieved_title_summary: [route.expectedTool],
				semantic_outcome: "resolved_current",
			},
		},
		selectedTarget: "campus-services-agent",
		status: "completed",
		traceId: input.traceId,
	};
}

describe("public chat web worker shell", () => {
	it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "campus-chat-staging.ayafeed.com"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[[env.staging.services]]");
		expect(wranglerConfig).toContain('binding = "APP_API"');
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain("[env.staging.vars]");
		expect(wranglerConfig).toContain('PUBLIC_CHAT_HOSTNAME = "campus-chat-staging.ayafeed.com"');
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(wranglerConfig).not.toContain("SENTRY_RELEASE = ");
		expect(packageManifest.scripts?.build).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["build:staging"]).toContain("CLOUDFLARE_ENV=staging");
		expect(packageManifest.scripts?.["build:staging"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.dev).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.preview).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy:preflight:staging");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
			"run-worker-staging-preflight.mjs",
		);
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
			"check_worker_secret_presence.py",
		);
		expect(deployStagingSource).toContain("buildWranglerCommandEnv");
		expect(deployStagingSource).toContain("loadRepoEnvFile");
		expect(deployStagingSource).toContain("resolveStagingSentryRelease");
		expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
		expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_SITE_KEY:");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_APPEARANCE:");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_EXECUTION:");
		expect(deployStagingSource).toContain("SENTRY_RELEASE:");
		expect(verifyStagingConfigSource).toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
		expect(verifyStagingConfigSource).toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
		expect(verifyStagingConfigSource).toContain("https://app-api.internal");
		expect(verifyStagingConfigSource).not.toContain("https://campus-api-staging.ayafeed.com");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"verify-staging-config.mjs",
		);
	});

	it("declares required secrets for local and staging worker environments", () => {
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain('required = ["SENTRY_DSN"]');
	});

	it("serves healthz and readyz from the worker shell", async () => {
		const health = await worker.fetch(new Request("https://chat.example.com/healthz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "ready",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {},
								},
							},
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});
		const ready = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "ready",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {},
								},
							},
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(health.status).toBe(200);
		expect(health.headers.get("cache-control")).toBe("no-store");
		await expect(health.json()).resolves.toEqual({
			status: "ok",
			app_name: "campus-agent-public-chat-web",
			surface: "public-chat-web",
			runtime: "cloudflare-worker",
		});

		expect(ready.status).toBe(200);
		expect(ready.headers.get("cache-control")).toBe("no-store");
		await expect(ready.json()).resolves.toEqual({
			status: "ready",
			app_api_base_url: "https://app-api.internal",
			dependencies: {
				appApiBinding: "configured",
				appApiRuntime: "ready",
				assets: "configured",
			},
			preflight: {
				campusServicesProductPath: {
					status: "ready",
					capabilityGate: "open",
					projectionSource: "postgres",
					checks: {
						contactDirectoryProjection: "ready",
						contactDirectoryReadModel: "ready",
						serviceGuideProjection: "ready",
						serviceGuideReadModel: "ready",
						serviceStatusProjection: "ready",
						serviceStatusReadModel: "ready",
						structuredQueryRuntime: "ready",
						transportSchedule: "ready",
						transportScheduleReadModel: "ready",
					},
					blockers: {},
				},
			},
			public_hostname: "chat.example.com",
			runtime: "cloudflare-worker",
		});
	});

	it("fails readyz closed when runtime dependencies are missing", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"APP_API binding",
						"ASSETS binding",
						"APP_API_BASE_URL",
						"PUBLIC_CHAT_HOSTNAME",
					],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails readyz closed when the app-api runtime is not ready", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							error: {
								code: "dependency_not_ready",
								message: "Runtime dependencies are not ready.",
							},
						}),
						{
							status: 503,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					appApiRuntime: "app-api readyz returned 503",
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("publishes app-api campus services product-path preflight blockers on readyz", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "blocked",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "not_ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {
										serviceGuideProjection: "service_guide_projection_ready is false",
									},
								},
							},
						}),
						{
							headers: {
								"content-type": "application/json",
							},
							status: 200,
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "ready",
			preflight: {
				campusServicesProductPath: {
					status: "blocked",
					blockers: {
						serviceGuideProjection: "service_guide_projection_ready is false",
					},
				},
			},
		});
	});

	it("redirects the removed preview path back to canonical /chat", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/chat/replatform-preview?from=legacy"),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 204 }),
				},
				ASSETS: {
					fetch: async () => new Response("should not hit assets", { status: 500 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://chat.example.com/chat?from=legacy");
	});

	it("serves the public chat app shell when frontend assets and app-api bridge are configured", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const html = await response.text();
		expect(html).toContain('<div id="root"></div>');
		expect(html).toContain("__PUBLIC_CHAT_AUTH_CONFIG__");
		expect(html).toContain('"turnstileSiteKey":"1x00000000000000000000AA"');
		expect(html).toContain('"turnstileAppearance":"interaction-only"');
		expect(html).toContain('"turnstileExecution":"render"');
	});

	it("honors explicit Turnstile runtime posture overrides in the injected auth shell config", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_TURNSTILE_APPEARANCE: "always",
			AUTH_TURNSTILE_EXECUTION: "execute",
			AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('"turnstileAppearance":"always"');
		expect(html).toContain('"turnstileExecution":"execute"');
	});

	it("fails closed when app-api binding is not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});

	it("fails closed when app-api base url is not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});

	it("fails closed when frontend assets are not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "frontend_assets_not_ready",
				message: "Public chat frontend assets are not configured.",
			},
		});
	});

	it("proxies same-site api requests to app-api and forwards auth/body headers only", async () => {
		let forwardedBody: string | null = null;
		let forwardedBaggage: string | null = null;
		let forwardedCookie: string | null = null;
		let forwardedIdempotencyKey: string | null = null;
		let forwardedOrigin: string | null = null;
		let forwardedReferer: string | null = null;
		let forwardedSentryTrace: string | null = null;
		let forwardedTraceId: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				method: "POST",
				headers: {
					accept: "application/json",
					cookie: "better-auth.session_token=test",
					"content-type": "application/json",
					"idempotency-key": "idem-001",
					baggage: "sentry-environment=test",
					"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
					origin: "https://chat.example.com",
					referer: "https://chat.example.com/chat",
					"x-spoofed-header": "drop-me",
					"x-trace-id": "trace-001",
				},
				body: JSON.stringify({
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				}),
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedBody = await request.text();
						forwardedBaggage = request.headers.get("baggage");
						forwardedCookie = request.headers.get("cookie");
						forwardedIdempotencyKey = request.headers.get("idempotency-key");
						forwardedOrigin = request.headers.get("origin");
						forwardedReferer = request.headers.get("referer");
						forwardedSentryTrace = request.headers.get("sentry-trace");
						forwardedTraceId = request.headers.get("x-trace-id");
						forwardedUrl = request.url;

						return new Response(
							JSON.stringify({
								answer: {
									result: {
										kind: "answer",
										requestId: "req_01HQ",
									},
								},
							}),
							{
								headers: {
									"content-type": "application/json; charset=utf-8",
									"x-request-id": "req_01HQ",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		await expect(response.json()).resolves.toEqual({
			answer: {
				result: {
					kind: "answer",
					requestId: "req_01HQ",
				},
			},
		});
		expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests");
		expect(forwardedCookie).toBe("better-auth.session_token=test");
		expect(forwardedIdempotencyKey).toBe("idem-001");
		expect(forwardedBaggage).toBe("sentry-environment=test");
		expect(forwardedOrigin).toBeNull();
		expect(forwardedReferer).toBeNull();
		expect(forwardedSentryTrace).toBe("0123456789abcdef0123456789abcdef-0123456789abcdef-1");
		expect(forwardedTraceId).toBe("trace-001");
		expect(forwardedBody).toBe(
			JSON.stringify({
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			}),
		);
	});

	it("proxies app-api lifecycle SSE responses without buffering or rewriting the stream", async () => {
		let forwardedAccept: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests/stream", {
				body: JSON.stringify({
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
					cookie: "better-auth.session_token=test",
					"idempotency-key": "idem-stream-001",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedAccept = request.headers.get("accept");
						forwardedUrl = request.url;

						return new Response(
							[
								'event: request.accepted\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"accepted"}',
								'event: request.completed\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"completed"}',
							].join("\n\n"),
							{
								headers: {
									"content-type": "text/event-stream; charset=utf-8",
									"x-request-id": "req_stream_01HQ",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_stream_01HQ");
		await expect(response.text()).resolves.toBe(
			[
				'event: request.accepted\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"accepted"}',
				'event: request.completed\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"completed"}',
			].join("\n\n"),
		);
		expect(forwardedAccept).toBe("text/event-stream");
		expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests/stream");
	});

	it("returns a contract-shaped dependency error when the app-api binding throws", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async () => {
						throw new Error("service binding failure");
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: null,
				message: "App API upstream is unavailable.",
				requestId: null,
				retryable: true,
				traceId: null,
			},
		});
	});

	it("serves the donor model catalog from the worker without proxying /api/models to app-api", async () => {
		const appApiFetch = vi.fn(async () => new Response("should not proxy", { status: 418 }));
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						data: {
							architecture: {
								input_modalities: ["text"],
							},
							endpoints: [
								{
									supported_parameters: ["tools", "reasoning"],
								},
							],
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 200,
					},
				),
		);

		try {
			const response = await worker.fetch(new Request("https://chat.example.com/api/models"), {
				APP_API: {
					fetch: appApiFetch,
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
			await expect(response.json()).resolves.toMatchObject({
				"moonshotai/kimi-k2-0905": {
					reasoning: true,
					tools: true,
					vision: false,
				},
			});
			expect(appApiFetch).not.toHaveBeenCalled();
			expect(fetchSpy).toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("forwards origin and referer for same-site auth requests", async () => {
		let forwardedCookie: string | null = null;
		let forwardedCaptchaResponse: string | null = null;
		let forwardedOrigin: string | null = null;
		let forwardedReferer: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/auth/sign-in/email", {
				method: "POST",
				headers: {
					accept: "application/json",
					cookie: "better-auth.session_token=test",
					"content-type": "application/json",
					origin: "https://chat.example.com",
					referer: "https://chat.example.com/login",
					"x-captcha-response": "captcha-token-01",
				},
				body: JSON.stringify({
					email: "jane@example.edu",
					password: "password12345",
				}),
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedCookie = request.headers.get("cookie");
						forwardedCaptchaResponse = request.headers.get("x-captcha-response");
						forwardedOrigin = request.headers.get("origin");
						forwardedReferer = request.headers.get("referer");
						forwardedUrl = request.url;

						return new Response(JSON.stringify({ ok: true }), {
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
							status: 200,
						});
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(forwardedUrl).toBe("https://app-api.internal/api/auth/sign-in/email");
		expect(forwardedCookie).toBe("better-auth.session_token=test");
		expect(forwardedCaptchaResponse).toBe("captcha-token-01");
		expect(forwardedOrigin).toBe("https://chat.example.com");
		expect(forwardedReferer).toBe("https://chat.example.com/login");
	});

	it("smokes a chat request through public-chat-web into app-api", async () => {
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			},
		};
		const appApi = createAppApi(appApiEnv, {
			chatCommandService: {
				submit: vi.fn().mockResolvedValue({
					answer: {
						conversation: {
							createdAt: "2026-03-28T07:59:00.000Z",
							id: "conv_01HQ",
							messages: [],
							title: "图书馆开放时间",
							updatedAt: "2026-03-28T08:00:01.000Z",
						},
						result: {
							kind: "answer",
							requestId: "req_01HQ",
							text: "图书馆开放到 22:00。",
							traceId: "trace_01HQ",
						},
					},
					requestId: "req_01HQ",
					traceId: "trace_01HQ",
				}),
			},
			getPrincipal: vi.fn().mockResolvedValue({
				actor: {
					departments: [],
					principalId: "user_01HQ",
					principalType: "campus_member",
					roles: ["student"],
					userId: "user_01HQ",
				},
				permissions: {
					chat: true,
					operator: false,
				},
				principal: {
					displayName: "Jane Doe",
					email: "jane@example.edu",
					principalId: "user_01HQ",
					type: "campus_member",
				},
				session: {
					expiresAt: "2026-03-29T07:00:00.000Z",
					sessionId: "sess_01HQ",
				},
			}),
		});

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=test",
					"idempotency-key": "idem-001",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () =>
						new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
							headers: {
								"content-type": "text/html; charset=utf-8",
							},
							status: 200,
						}),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		await expect(response.json()).resolves.toMatchObject({
			answer: {
				result: {
					kind: "answer",
					requestId: "req_01HQ",
				},
			},
		});
	});

	it("routes campus-services prompts through public-chat-web into structured agent handoffs", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const observedResults: Record<string, unknown>[] = [];
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(async (input: SupervisorExecutionInput) => {
				const route = findCampusServicesRoutingCase(input.userGoal);
				const response = buildCampusServicesExecutionResponse(input, route);
				observedResults.push(response.result as Record<string, unknown>);
				return response;
			}),
		};
		const chatCommandService = buildChatCommandService({
			conversationStore,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			store,
			supervisor,
		});
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			},
		};
		const appApi = createAppApi(appApiEnv, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createPrincipal()),
		});

		for (const route of CAMPUS_SERVICES_ROUTING_CASES) {
			const response = await worker.fetch(
				new Request("https://chat.example.com/api/chat/requests", {
					body: JSON.stringify({
						prompt: route.prompt,
					}),
					headers: {
						"content-type": "application/json",
						cookie: "better-auth.session_token=test",
						"idempotency-key": `idem-${route.expectedTool}`,
					},
					method: "POST",
				}),
				{
					APP_API: {
						fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
					},
					APP_API_BASE_URL: "https://app-api.internal",
					ASSETS: {
						fetch: async () =>
							new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
								headers: {
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							}),
					},
					PUBLIC_CHAT_HOSTNAME: "chat.example.com",
				},
			);
			const payload = (await response.json()) as {
				answer?: {
					conversation?: {
						messages?: Array<{
							structuredParts?: Array<{
								type?: string;
								traceCards?: Array<{
									refs?: string[];
									title?: string;
								}>;
							}>;
						}>;
					};
					result?: {
						kind?: string;
						text?: string;
					};
				};
			};

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(payload.answer?.result).toMatchObject({
				kind: "answer",
				text: expect.stringContaining(route.expectedAnswerFragment),
			});
			if (payload.answer?.result?.text) {
				expect(payload.answer.result.text).not.toContain("projection_internal_state");
				expect(payload.answer.result.text).not.toContain("campus_services_release");
				expect(payload.answer.result.text).not.toContain("authenticated_notice:");
				expect(payload.answer.result.text).not.toContain("official_web:");
			}
			const lastMessage = payload.answer?.conversation?.messages?.at(-1);
			const tracePart = lastMessage?.structuredParts?.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
			const tracePayload = JSON.stringify(tracePart ?? {});
			expect(tracePayload).not.toContain("authenticated_notice:");
			expect(tracePayload).not.toContain("official_web:");
			expect(tracePayload).not.toContain("release_id");
			expect(tracePayload).not.toContain("projection_internal_state");
			expect(tracePayload).not.toContain("table_parser_state");
			expect(tracePayload).toContain("title");
			expect(tracePayload).toContain("refs");
		}

		expect(supervisor.execute).toHaveBeenCalledTimes(CAMPUS_SERVICES_ROUTING_CASES.length);
		for (const [index, route] of CAMPUS_SERVICES_ROUTING_CASES.entries()) {
			const supervisorInput = vi.mocked(supervisor.execute).mock.calls[index]?.[0];
			expect(supervisorInput).toMatchObject({
				requestedCapability: null,
				surface: "public_chat_web",
				userGoal: route.prompt,
			});
			expect(supervisorInput?.context.actor).toMatchObject({
				principalId: "user_01HQ",
				principalType: "student",
				userId: "user_01HQ",
			});

			expect(observedResults[index]).toMatchObject({
				allowed_tools: [route.expectedTool],
				payload_kind: route.expectedTool,
				target: "campus-services-agent",
				tool_result: {
					outcome: "resolved_current",
				},
			});

			const finalizedWrite = finalWrites[index] as FinalizeRequestWrite;
			expect(finalizedWrite.requestExecution).toMatchObject({
				diagnostics: {
					groundingVerdict: "supported",
					retrievedTitleSummary: [route.expectedTool],
					semanticOutcome: "resolved_current",
				},
				selectedTarget: "campus-services-agent",
				status: "completed",
				surface: "public_chat_web",
			});
			expect(finalizedWrite.assistantMessage).toMatchObject({
				kind: "answer",
				text: expect.stringContaining(route.expectedAnswerFragment),
			});
			const tracePart = finalizedWrite.assistantMessage.structuredParts.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
		}
	});

	it("fails closed when app-api binding is missing", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/api/me"), {
			APP_API_BASE_URL: "https://app-api.internal",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});
});
