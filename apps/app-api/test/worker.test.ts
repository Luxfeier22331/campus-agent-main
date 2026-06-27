import { describe, expect, it, vi } from "vitest";
import stagingPreflightSource from "../../../scripts/run-worker-staging-preflight.mjs?raw";
import packageManifestRaw from "../package.json?raw";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import runWithStagingDbEnvSource from "../scripts/run-with-staging-db-env.mjs?raw";
import runWithStagingProofEnvSource from "../scripts/run-with-staging-proof-env.mjs?raw";
import runWithStagingSmokeEnvSource from "../scripts/run-with-staging-smoke-env.mjs?raw";
import { createWorkerRuntime } from "../src/index";
import localSmokeWranglerConfig from "../wrangler.local-smoke.toml?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

function readTomlBlock(source: string, startMarker: string, endMarker: string): string {
	const startIndex = source.indexOf(startMarker);
	if (startIndex < 0) {
		return "";
	}

	const fromStart = source.slice(startIndex);
	const endIndex = fromStart.indexOf(endMarker);
	if (endIndex < 0) {
		return fromStart;
	}

	return fromStart.slice(0, endIndex);
}

const env = {
	APP_API_NAME: "campus-agent-app-api",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member" as const,
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@muc.edu.cn",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

function createExecutionContext(waitUntil = vi.fn()): ExecutionContext {
	return {
		passThroughOnException() {
			/* noop */
		},
		props: {},
		waitUntil,
	} as unknown as ExecutionContext;
}

function createRuntimeReadinessResult() {
	return {
		dependencies: {
			auth: "ready",
			authShellOrigin: "configured",
			database: "ready",
			executionRuntime: "not_required",
			officialWebHandoff: "not_configured",
			operatorSurface: "configured",
			executionControl: "ready",
		},
		failed: {},
		preflight: {
			campusServicesProductPath: {
				status: "ready",
				toolGate: "open",
				projectionSource: "postgres",
				checks: {
					toolReadModelRuntime: "ready",
					transportSchedule: "ready",
					transportScheduleReadModel: "ready",
				},
				blockers: {},
			},
		},
	};
}

function createDocsReadinessResult() {
	return {
		dependencies: {
			auth: "ready" as const,
			database: "ready" as const,
			docsReadModel: "ready" as const,
		},
		failed: {},
	};
}

describe("app-api worker foundation", () => {
	it("declares the staging custom domain, hyperdrive binding, and deploy gate", () => {
		const stagingVarsBlock = readTomlBlock(
			wranglerConfig,
			"[env.staging.vars]",
			"[env.staging.secrets]",
		);
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[env.local.hyperdrive]]");
		expect(wranglerConfig).toContain('binding = "APP_API_DB"');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "api-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[[env.staging.hyperdrive]]");
		expect(wranglerConfig).toContain("[env.staging.vars]");
		expect(wranglerConfig).toContain('APP_API_ENVIRONMENT = "staging"');
		expect(stagingVarsBlock).toContain(
			'AUTH_SHELL_ORIGIN = "https://campus-staging.mucwiki-edge.link"',
		);
		expect(stagingVarsBlock).toContain('APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST = "muc.edu.cn"');
		expect(stagingVarsBlock).not.toContain("EXECUTION_CONTROL_BASE_URL");
		expect(stagingVarsBlock).toContain(
			'APP_API_OPERATOR_EMAIL_ALLOWLIST = "ops@example.com,help_bot@outlook.com"',
		);
		expect(stagingVarsBlock).toContain('APP_API_END_USER_EMAIL_ALLOWLIST = "help_bot@outlook.com"');
		expect(stagingVarsBlock).toContain('EXECUTION_CONTROL_TIMEOUT_MS = "95000"');
		expect(stagingVarsBlock).not.toContain("CHATKIT_ADAPTER_BASE_URL");
		expect(stagingVarsBlock).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(stagingVarsBlock).not.toContain("SENTRY_RELEASE = ");
		expect(stagingVarsBlock).toContain(
			'APP_API_OTEL_INGEST_ENDPOINT = "https://otel-collector-staging.mucwiki-edge.link"',
		);
		expect(stagingVarsBlock).not.toContain("AXIOM_ENDPOINT");
		expect(stagingVarsBlock).not.toContain("AXIOM_DATASET");
		expect(packageManifest.scripts?.dev).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain("deploy:preflight:staging");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toBeUndefined();
		expect(deployStagingSource).toContain("buildWranglerCommandEnv");
		expect(deployStagingSource).toContain("loadRepoStagingEnvFile");
		expect(deployStagingSource).toContain("resolveStagingSentryRelease");
		expect(deployStagingSource).toContain("run-worker-staging-preflight.mjs");
		expect(packageManifest.scripts?.["chat:e2e:staging"]).toContain("chat-durable-e2e-staging.ts");
		expect(packageManifest.scripts?.["chat:smoke:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:bootstrap:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:migrate:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:reconcile-shared-drift:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["test:all"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(runWithStagingDbEnvSource).toContain("loadRepoStagingEnvFile");
		expect(runWithStagingDbEnvSource).not.toContain("loadRepoEnvFile");
		expect(runWithStagingDbEnvSource).not.toContain("process.loadEnvFile");
		expect(runWithStagingDbEnvSource).toContain("STAGING_APP_API_OPERATOR_DATABASE_URL");
		expect(runWithStagingDbEnvSource).toContain("APP_API_OPERATOR_DATABASE_URL");
		expect(runWithStagingProofEnvSource).toContain("loadRepoStagingEnvFile");
		expect(runWithStagingProofEnvSource).not.toContain("process.loadEnvFile");
		expect(runWithStagingProofEnvSource).toContain("STAGING_APP_API_OPERATOR_DATABASE_URL");
		expect(runWithStagingProofEnvSource).toContain("APP_API_OPERATOR_DATABASE_URL");
		expect(runWithStagingProofEnvSource).toContain("CLOUDFLARE_ACCOUNT_ID");
		expect(runWithStagingProofEnvSource).toContain("CLOUDFLARE_API_TOKEN");
		expect(runWithStagingProofEnvSource).toContain("run-with-staging-smoke-env.mjs");
		expect(runWithStagingSmokeEnvSource).toContain("loadStagingSmokeEnvFile");
		expect(runWithStagingSmokeEnvSource).not.toContain("process.loadEnvFile");
		expect(runWithStagingDbEnvSource).toContain("https://campus-staging.mucwiki-edge.link");
		expect(stagingPreflightSource).toContain("STAGING_EXECUTION_CONTROL_BASE_URL");
		expect(stagingPreflightSource).toContain("STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID");
		expect(stagingPreflightSource).toContain("STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET");
		expect(stagingPreflightSource).toContain("loadRepoStagingEnvFile");
		expect(stagingPreflightSource).toContain('new URL("/healthz", baseUrl)');
		expect(stagingPreflightSource).not.toContain('new URL("/readyz", baseUrl)');
		expect(deployStagingSource).toContain("execution-control trusted machine ingress");
		expect(deployStagingSource).toContain("EXECUTION_CONTROL_ACCESS_CLIENT_ID");
		expect(deployStagingSource).toContain("EXECUTION_CONTROL_ACCESS_CLIENT_SECRET");
		expect(deployStagingSource).not.toMatch(
			/EXECUTION_CONTROL_ACCESS_CLIENT_ID:\$\{accessClientId\}/,
		);
		expect(deployStagingSource).not.toMatch(
			/EXECUTION_CONTROL_ACCESS_CLIENT_SECRET:\$\{accessClientSecret\}/,
		);
		expect(deployStagingSource).not.toContain("execution-control origin");
		expect(stagingPreflightSource).toContain("bootstrap-shared-product-with-seeds.mjs");
		expect(stagingPreflightSource).toContain("reconcile-shared-db-drift.mjs");
	});

	it("declares non-inheritable required secrets for local and staging worker environments", () => {
		const localVarsBlock = readTomlBlock(wranglerConfig, "[env.local.vars]", "[env.local.secrets]");
		const localSecretsBlock = readTomlBlock(
			wranglerConfig,
			"[env.local.secrets]",
			"[[env.staging.routes]]",
		);
		const stagingSecretsBlock = readTomlBlock(
			wranglerConfig,
			"[env.staging.secrets]",
			"[[env.staging.hyperdrive]]",
		);
		expect(wranglerConfig).toContain("[env.local.secrets]");
		expect(localVarsBlock).toContain('AUTH_SHELL_ORIGIN = "http://127.0.0.1:27014"');
		expect(wranglerConfig).toContain('"RESEND_API_KEY"');
		expect(wranglerConfig).toContain('"AUTH_RESET_EMAIL_FROM"');
		expect(wranglerConfig).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(localSecretsBlock).toContain('"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN"');
		expect(localSecretsBlock).toContain('"APP_API_OTEL_INGEST_SHARED_SECRET"');
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(stagingSecretsBlock).toContain('"BETTER_AUTH_SECRET"');
		expect(stagingSecretsBlock).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(stagingSecretsBlock).toContain('"RESEND_API_KEY"');
		expect(stagingSecretsBlock).toContain('"AUTH_RESET_EMAIL_FROM"');
		expect(stagingSecretsBlock).toContain('"EXECUTION_CONTROL_SHARED_SECRET"');
		expect(stagingSecretsBlock).toContain('"EXECUTION_CONTROL_ACCESS_CLIENT_ID"');
		expect(stagingSecretsBlock).toContain('"EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"');
		expect(stagingSecretsBlock).toContain('"APP_API_INTERNAL_SHARED_SECRET"');
		expect(stagingSecretsBlock).toContain('"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY"');
		expect(stagingSecretsBlock).toContain('"APP_API_STAGING_SMOKE_AUTH_SECRET"');
		expect(stagingSecretsBlock).not.toContain('"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN"');
		expect(stagingSecretsBlock).toContain('"SENTRY_DSN"');
		expect(stagingSecretsBlock).toContain('"APP_API_OTEL_INGEST_SHARED_SECRET"');
		expect(stagingSecretsBlock).not.toContain('"AXIOM_TOKEN"');
	});

	it("declares a local Hyperdrive binding for APP_API_DB in wrangler config", () => {
		expect(wranglerConfig).toContain("[env.local]");
		expect(wranglerConfig).toContain("[[env.local.hyperdrive]]");
		expect(wranglerConfig).toContain('binding = "APP_API_DB"');
	});

	it("points the local smoke execution upstream at the docker-first execution-control port", () => {
		expect(localSmokeWranglerConfig).toContain(
			'EXECUTION_CONTROL_BASE_URL = "http://127.0.0.1:27051"',
		);
		expect(localSmokeWranglerConfig).not.toContain("CHATKIT_ADAPTER_BASE_URL");
		expect(localSmokeWranglerConfig).toContain(
			'APP_API_OTEL_INGEST_ENDPOINT = "http://127.0.0.1:4318"',
		);
		expect(localSmokeWranglerConfig).not.toContain("127.0.0.1:8081");
	});

	it("keeps local smoke non-secret vars in config so .dev.vars only supplies secrets", () => {
		expect(localSmokeWranglerConfig).toContain("[secrets]");
		const localSmokeSecretsBlock = localSmokeWranglerConfig.split("[secrets]")[1] ?? "";
		expect(localSmokeSecretsBlock).toContain('"BETTER_AUTH_SECRET"');
		expect(localSmokeSecretsBlock).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(localSmokeSecretsBlock).toContain('"RESEND_API_KEY"');
		expect(localSmokeSecretsBlock).toContain('"AUTH_RESET_EMAIL_FROM"');
		expect(localSmokeSecretsBlock).toContain('"EXECUTION_CONTROL_SHARED_SECRET"');
		expect(localSmokeSecretsBlock).toContain('"APP_API_INTERNAL_SHARED_SECRET"');
		expect(localSmokeSecretsBlock).toContain('"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY"');
		expect(localSmokeSecretsBlock).not.toContain('"EXECUTION_CONTROL_BASE_URL"');
		expect(localSmokeWranglerConfig).toContain('APP_API_ENVIRONMENT = "development"');
		expect(localSmokeWranglerConfig).toContain(
			'APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST = "muc.edu.cn"',
		);
		expect(localSmokeWranglerConfig).toContain(
			'APP_API_OPERATOR_EMAIL_ALLOWLIST = "ops@example.com"',
		);
	});

	it("serves healthz and readyz from the worker shell", async () => {
		const runtime = createWorkerRuntime(env, {
			docsReadinessProbe: vi.fn().mockResolvedValue(createDocsReadinessResult()),
			runtimeReadinessProbe: vi.fn().mockResolvedValue(createRuntimeReadinessResult()),
		});
		const health = await runtime.fetch(
			new Request("https://app-api.internal/healthz"),
			createExecutionContext(),
		);
		const ready = await runtime.fetch(
			new Request("https://app-api.internal/readyz"),
			createExecutionContext(),
		);

		expect(health.status).toBe(200);
		await expect(health.json()).resolves.toEqual({
			status: "ok",
			app: "campus-agent-app-api",
		});

		expect(ready.status).toBe(200);
		await expect(ready.json()).resolves.toEqual({
			status: "ready",
			dependencies: {
				auth: "ready",
				authShellOrigin: "configured",
				database: "ready",
				executionRuntime: "not_required",
				officialWebHandoff: "not_configured",
				operatorSurface: "configured",
				executionControl: "ready",
			},
			preflight: {
				campusServicesProductPath: {
					status: "ready",
					toolGate: "open",
					projectionSource: "postgres",
					checks: {
						toolReadModelRuntime: "ready",
						transportSchedule: "ready",
						transportScheduleReadModel: "ready",
					},
					blockers: {},
				},
			},
		});
	});

	it("serves docs control-plane readiness separately from product runtime readiness", async () => {
		const runtime = createWorkerRuntime(env, {
			docsReadinessProbe: vi.fn().mockResolvedValue(createDocsReadinessResult()),
			runtimeReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "ready",
					authShellOrigin: "configured",
					database: "ready",
					executionRuntime: "not_required",
					officialWebHandoff: "not_configured",
					operatorSurface: "configured",
					executionControl: "not_ready",
				},
				failed: {
					executionControl: "execution-control /readyz returned 503",
				},
			}),
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/docs/readyz"),
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "ready",
			dependencies: {
				auth: "ready",
				database: "ready",
				docsReadModel: "ready",
			},
		});
	});

	it("fails readyz closed when required config is missing", async () => {
		const runtime = createWorkerRuntime(
			{
				APP_API_NAME: "campus-agent-app-api",
				APP_API_ENVIRONMENT: "test",
			},
			{
				runtimeReadinessProbe: vi.fn(),
			},
		);
		const response = await runtime.fetch(
			new Request("https://app-api.internal/readyz"),
			createExecutionContext(),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Runtime configuration is incomplete.",
				retryable: true,
				traceId: null,
				requestId: null,
				details: {
					missing: [
						"APP_API_DB.connectionString",
						"BETTER_AUTH_SECRET",
						"AUTH_TURNSTILE_SECRET_KEY",
						"RESEND_API_KEY",
						"AUTH_RESET_EMAIL_FROM",
						"EXECUTION_CONTROL_BASE_URL",
						"EXECUTION_CONTROL_SHARED_SECRET",
						"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
						"APP_API_OPERATOR_EMAIL_ALLOWLIST",
						"APP_API_INTERNAL_SHARED_SECRET",
					],
				},
			},
		});
	});

	it("fails readyz closed when runtime probes detect unavailable dependencies", async () => {
		const runtime = createWorkerRuntime(env, {
			runtimeReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "not_ready",
					authShellOrigin: "configured",
					database: "ready",
					executionRuntime: "not_required",
					officialWebHandoff: "not_configured",
					operatorSurface: "configured",
					executionControl: "not_ready",
				},
				failed: {
					auth: "better-auth session runtime failed probe",
					executionControl: "execution-control /readyz returned 503",
				},
			}),
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/readyz"),
			createExecutionContext(),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Runtime dependencies are not ready.",
				retryable: true,
				traceId: null,
				requestId: null,
				details: {
					failed: {
						auth: "better-auth session runtime failed probe",
						executionControl: "execution-control /readyz returned 503",
					},
				},
			},
		});
	});

	it("fails readyz closed when deployed durable runtime preflight is blocked", async () => {
		const runtime = createWorkerRuntime(env, {
			runtimeReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "ready",
					authShellOrigin: "configured",
					database: "ready",
					executionRuntime: "not_ready",
					officialWebHandoff: "not_configured",
					operatorSurface: "configured",
					executionControl: "ready",
				},
				failed: {
					executionRuntime: "temporal_runtime is not configured and healthy",
				},
				preflight: {
					executionRuntime: {
						status: "blocked",
						checks: {
							runProjectionStore: "ready",
							temporalRuntime: "not_ready",
						},
						blockers: {
							temporalRuntime: "temporal_runtime is not configured and healthy",
						},
					},
				},
			}),
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/readyz"),
			createExecutionContext(),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Runtime dependencies are not ready.",
				retryable: true,
				traceId: null,
				requestId: null,
				details: {
					failed: {
						executionRuntime: "temporal_runtime is not configured and healthy",
					},
					preflight: {
						executionRuntime: {
							status: "blocked",
							checks: {
								runProjectionStore: "ready",
								temporalRuntime: "not_ready",
							},
							blockers: {
								temporalRuntime: "temporal_runtime is not configured and healthy",
							},
						},
					},
				},
			},
		});
	});

	it("publishes campus services product-path preflight blockers on readyz", async () => {
		const runtime = createWorkerRuntime(env, {
			runtimeReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "ready",
					authShellOrigin: "configured",
					database: "ready",
					executionRuntime: "not_required",
					officialWebHandoff: "not_configured",
					operatorSurface: "configured",
					executionControl: "ready",
				},
				failed: {},
				preflight: {
					campusServicesProductPath: {
						status: "ready",
						toolGate: "open",
						projectionSource: "postgres",
						checks: {
							toolReadModelRuntime: "ready",
							transportSchedule: "ready",
							transportScheduleReadModel: "ready",
						},
						blockers: {},
					},
				},
			}),
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/readyz"),
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "ready",
			preflight: {
				campusServicesProductPath: {
					status: "ready",
					blockers: {},
				},
			},
		});
	});

	it("schedules a request projection drain after a successful online answer request", async () => {
		const requestProjector = {
			drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
			drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
		};
		const chatCommandService = {
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
		};
		const waitUntil = vi.fn();
		const runtime = createWorkerRuntime(env, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			requestProjector,
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
			createExecutionContext(waitUntil),
		);

		expect(response.status).toBe(200);
		expect(waitUntil).toHaveBeenCalledTimes(1);
		await waitUntil.mock.calls[0][0];
		expect(requestProjector.drainRequest).toHaveBeenCalledWith("req_01HQ");
		expect(requestProjector.drain).not.toHaveBeenCalled();
	});

	it("does not schedule a request projection drain after a successful internal eval request", async () => {
		const requestProjector = {
			drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
			drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
		};
		const chatCommandService = {
			submit: vi.fn().mockResolvedValue({
				answer: {
					conversation: {
						createdAt: "2026-03-28T07:59:00.000Z",
						id: "conv_eval_01HQ",
						messages: [],
						title: "图书馆开放时间",
						updatedAt: "2026-03-28T08:00:01.000Z",
					},
					result: {
						kind: "answer",
						requestId: "req_eval_01HQ",
						text: "图书馆开放到 22:00。",
						traceId: "trace_eval_01HQ",
					},
				},
				requestId: "req_eval_01HQ",
				traceId: "trace_eval_01HQ",
			}),
		};
		const waitUntil = vi.fn();
		const runtime = createWorkerRuntime(env, {
			chatCommandService,
			requestProjector,
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/internal/evals/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "app-api-internal-secret",
					"x-eval-user-email": "eval-benchmark@example.edu",
				},
				method: "POST",
			}),
			createExecutionContext(waitUntil),
		);

		expect(response.status).toBe(200);
		expect(waitUntil).not.toHaveBeenCalled();
		expect(requestProjector.drainRequest).not.toHaveBeenCalled();
		expect(requestProjector.drain).not.toHaveBeenCalled();
	});

	it("fails closed when request projection drain cannot be scheduled through waitUntil", async () => {
		const requestProjector = {
			drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
			drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
		};
		const chatCommandService = {
			submit: vi.fn().mockResolvedValue({
				answer: {
					conversation: {
						createdAt: "2026-03-28T07:59:00.000Z",
						id: "conv_waituntil_closed_01HQ",
						messages: [],
						title: "图书馆开放时间",
						updatedAt: "2026-03-28T08:00:01.000Z",
					},
					result: {
						kind: "answer",
						requestId: "req_waituntil_closed_01HQ",
						text: "图书馆开放到 22:00。",
						traceId: "trace_waituntil_closed_01HQ",
					},
				},
				requestId: "req_waituntil_closed_01HQ",
				traceId: "trace_waituntil_closed_01HQ",
			}),
		};
		const runtime = createWorkerRuntime(env, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			requestProjector,
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(503);
		await Promise.resolve();
		expect(requestProjector.drainRequest).not.toHaveBeenCalled();
		expect(requestProjector.drain).not.toHaveBeenCalled();
	});
});
