import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import stagingPublishWorkflowSource from "../../../.github/workflows/execution-runtime-publish.yml?raw";
import rootPackageManifestRaw from "../../../package.json?raw";
import appApiSmokeEntrypointSource from "../../../scripts/smoke/app-api.ts?raw";
import packageManifestRaw from "../package.json?raw";
import stagingPreflightSource from "../scripts/preflight-staging.ts?raw";
import uploadStagingVersionSource from "../scripts/upload-staging-version.ts?raw";
import { createWorkerRuntime } from "../src/index";
import localSmokeWranglerConfig from "../wrangler.local-smoke.toml?raw";
import wranglerConfig from "../wrangler.toml?raw";

interface WranglerObservabilityConfig {
	enabled?: boolean;
	logs?: {
		destinations?: string[];
		enabled?: boolean;
		head_sampling_rate?: number;
		invocation_logs?: boolean;
		persist?: boolean;
	};
	traces?: {
		destinations?: string[];
		enabled?: boolean;
		head_sampling_rate?: number;
		persist?: boolean;
	};
}

const parsedWranglerConfig = parse(wranglerConfig) as {
	env?: { staging?: { observability?: WranglerObservabilityConfig } };
	observability?: WranglerObservabilityConfig;
};

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};
const rootPackageManifest = JSON.parse(rootPackageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};
const retiredExecutionControlPublicUrlKey = ["STAGING", "EXECUTION", "CONTROL", "BASE", "URL"].join(
	"_",
);
const retiredExecutionControlAccessClientIdKey = [
	"STAGING",
	"EXECUTION",
	"CONTROL",
	"ACCESS",
	"CLIENT",
	"ID",
].join("_");
const retiredExecutionControlAccessClientSecretKey = [
	"STAGING",
	"EXECUTION",
	"CONTROL",
	"ACCESS",
	"CLIENT",
	"SECRET",
].join("_");
const retiredExecutionControlAccessClientIdKeyLocal = [
	"EXECUTION",
	"CONTROL",
	"ACCESS",
	"CLIENT",
	"ID",
].join("_");
const retiredExecutionControlAccessClientSecretKeyLocal = [
	"EXECUTION",
	"CONTROL",
	"ACCESS",
	"CLIENT",
	"SECRET",
].join("_");
const docsReleaseId = `sha256:${"a".repeat(64)}`;

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
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "example.edu",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
	APP_API_DB_FRESH: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

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
			database: "ready",
		},
		failed: {},
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
	it("exports only application logs to the staging Axiom destination", () => {
		expect(parsedWranglerConfig.observability).toEqual({
			enabled: true,
			logs: {
				enabled: true,
				head_sampling_rate: 1,
				invocation_logs: false,
				persist: false,
			},
			traces: {
				enabled: false,
				head_sampling_rate: 0,
				persist: false,
			},
		});
		expect(parsedWranglerConfig.env?.staging?.observability).toEqual({
			enabled: true,
			logs: {
				destinations: ["axiom-staging-logs"],
				enabled: true,
				head_sampling_rate: 1,
				invocation_logs: false,
				persist: false,
			},
			traces: {
				enabled: false,
				head_sampling_rate: 0,
				persist: false,
			},
		});
	});

	it("keeps traffic out of Wrangler and injects staging bindings at upload time", () => {
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
		expect(wranglerConfig).not.toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain("[[env.staging.hyperdrive]]");
		expect(wranglerConfig).toContain("[env.staging.vars]");
		expect(wranglerConfig).toContain('APP_API_ENVIRONMENT = "staging"');
		expect(stagingVarsBlock).toContain(
			'AUTH_SHELL_ORIGIN = "https://campus-staging.mucwiki-edge.link"',
		);
		expect(stagingVarsBlock).toContain('APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST = "example.edu"');
		expect(stagingVarsBlock).not.toContain("EXECUTION_CONTROL_BASE_URL");
		expect(stagingVarsBlock).toContain('APP_API_END_USER_EMAIL_ALLOWLIST = "help_bot@outlook.com"');
		expect(stagingVarsBlock).toContain(
			'EXECUTION_CONTROL_PRIVATE_ORIGIN = "http://execution-control.campus-agent-staging.svc.cluster.local:8000"',
		);
		expect(stagingVarsBlock).toContain('EXECUTION_CONTROL_TIMEOUT_MS = "95000"');
		expect(wranglerConfig).toContain("[[env.staging.vpc_services]]");
		expect(wranglerConfig).toContain('binding = "EXECUTION_CONTROL_PRIVATE"');
		expect(wranglerConfig).toContain('service_id = "00000000-0000-0000-0000-000000000000"');
		expect(wranglerConfig).toContain("remote = true");
		expect(stagingVarsBlock).not.toContain("CHATKIT_ADAPTER_BASE_URL");
		expect(stagingVarsBlock).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(stagingVarsBlock).not.toContain("SENTRY_RELEASE = ");
		expect(stagingVarsBlock).not.toContain("APP_API_OTEL_INGEST_");
		expect(stagingVarsBlock).not.toContain("AXIOM_ENDPOINT");
		expect(stagingVarsBlock).not.toContain("AXIOM_DATASET");
		expect(wranglerConfig).toContain('destinations = ["axiom-staging-logs"]');
		expect(wranglerConfig).toContain("invocation_logs = false");
		expect(wranglerConfig).not.toContain("axiom-staging-traces");
		expect(packageManifest.scripts?.dev).toBe(
			"pnpm --dir ../.. exec tsx scripts/dev/service.ts app-api",
		);
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.ts");
		expect(packageManifest.scripts?.["deploy:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["upload:staging"]).toContain("upload-staging-version.ts");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toBeUndefined();
		expect(uploadStagingVersionSource).toContain("uploadStagingWorkerVersion");
		expect(uploadStagingVersionSource).toContain("loadRepoStagingEnvFile");
		expect(uploadStagingVersionSource).toContain("resolveStagingSentryRelease");
		expect(uploadStagingVersionSource).toContain("SENTRY_APP_API_PROJECT_SLUG");
		expect(uploadStagingVersionSource).toContain(
			'const sentryArtifactDirectory = resolve(configDir, "sentry")',
		);
		expect(uploadStagingVersionSource).toContain("wranglerOutdir: sentryArtifactDirectory");
		expect(uploadStagingVersionSource).toContain("SENTRY_APP_API_DSN");
		expect(uploadStagingVersionSource).toContain("EXECUTION_CONTROL_VPC_SERVICE_ID");
		expect(uploadStagingVersionSource).toContain("APP_API_DB_HYPERDRIVE_ID");
		expect(uploadStagingVersionSource).toContain("APP_API_DB_FRESH_HYPERDRIVE_ID");
		expect(uploadStagingVersionSource).toContain("AUTH_RESET_EMAIL_FROM");
		expect(uploadStagingVersionSource).toContain("STAGING_APP_API_EXECUTION_SHARED_SECRET");
		expect(uploadStagingVersionSource).toContain("STAGING_OPS_WEB_INTERNAL_TOKEN");
		expect(uploadStagingVersionSource).toContain("secretsFile: secretsPath");
		expect(uploadStagingVersionSource).toContain("mode: 0o600");
		expect(stagingPublishWorkflowSource).toContain("STAGING_APP_API_EXECUTION_SHARED_SECRET:");
		expect(stagingPublishWorkflowSource).toContain(
			"secrets.STAGING_APP_API_EXECUTION_SHARED_SECRET",
		);
		expect(stagingPublishWorkflowSource).toContain("STAGING_OPS_WEB_INTERNAL_TOKEN:");
		expect(stagingPublishWorkflowSource).toContain("secrets.STAGING_OPS_WEB_INTERNAL_TOKEN");
		expect(uploadStagingVersionSource).toContain("preflight-staging.ts");
		expect(packageManifest.scripts?.["chat:e2e:staging"]).toBeUndefined();
		expect(rootPackageManifest.scripts?.["smoke:app-api"]).toBe(
			"pnpm exec tsx scripts/smoke/app-api.ts",
		);
		expect(appApiSmokeEntrypointSource).toContain("chat-durable-staging.ts");
		expect(packageManifest.scripts?.["chat:smoke:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["upload:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:bootstrap:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:migrate:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["db:reconcile-shared-drift:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["test:all"]).toBeUndefined();
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(appApiSmokeEntrypointSource).toContain("./scripts/deploy/run-with-staging-smoke-env.ts");
		expect(appApiSmokeEntrypointSource).toContain("apps/app-api");
		expect(stagingPreflightSource).not.toContain(retiredExecutionControlPublicUrlKey);
		expect(stagingPreflightSource).not.toContain(retiredExecutionControlAccessClientIdKey);
		expect(stagingPreflightSource).not.toContain(retiredExecutionControlAccessClientSecretKey);
		expect(stagingPreflightSource).toContain("loadRepoStagingEnvFile");
		expect(stagingPreflightSource).not.toContain("check-worker-secret-presence.ts");
		expect(stagingPreflightSource).toContain("apps/app-api/scripts/verify-staging-config.ts");
		expect(stagingPreflightSource).not.toContain('new URL("/readyz", baseUrl)');
		expect(stagingPreflightSource).not.toContain('new URL("/healthz", baseUrl)');
		expect(uploadStagingVersionSource).not.toContain("execution-control trusted machine ingress");
		expect(uploadStagingVersionSource).not.toContain(retiredExecutionControlAccessClientIdKeyLocal);
		expect(uploadStagingVersionSource).not.toContain(
			retiredExecutionControlAccessClientSecretKeyLocal,
		);
		expect(uploadStagingVersionSource).not.toContain("execution-control origin");
		expect(stagingPreflightSource).not.toContain("run-with-staging-db-env.mjs");
		expect(stagingPreflightSource).not.toContain("bootstrap-shared-product-with-seeds.mjs");
		expect(stagingPreflightSource).not.toContain("bootstrap-shared-product-database.ts");
		expect(stagingPreflightSource).not.toContain("drizzle-kit");
	});

	it("declares non-inheritable required secrets for local and staging worker environments", () => {
		const localVarsBlock = readTomlBlock(wranglerConfig, "[env.local.vars]", "[env.local.secrets]");
		const localSecretsBlock = readTomlBlock(
			wranglerConfig,
			"[env.local.secrets]",
			"[env.staging.vars]",
		);
		const stagingSecretsBlock = readTomlBlock(
			wranglerConfig,
			"[env.staging.secrets]",
			"[[env.staging.hyperdrive]]",
		);
		expect(wranglerConfig).toContain("[env.local.secrets]");
		expect(localVarsBlock).toContain('AUTH_SHELL_ORIGIN = "http://127.0.0.1:27014"');
		expect(wranglerConfig).toContain('"RESEND_API_KEY"');
		expect(localVarsBlock).toContain('AUTH_RESET_EMAIL_FROM = "Campus Agent <auth@example.com>"');
		expect(wranglerConfig).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(localSecretsBlock).toContain('"OPS_WEB_INTERNAL_TOKEN"');
		expect(localSecretsBlock).not.toContain('"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN"');
		expect(localSecretsBlock).not.toContain("APP_API_OTEL_INGEST_");
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(stagingSecretsBlock).toContain('"BETTER_AUTH_SECRET"');
		expect(stagingSecretsBlock).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(stagingSecretsBlock).toContain('"RESEND_API_KEY"');
		expect(stagingSecretsBlock).not.toContain('"AUTH_RESET_EMAIL_FROM"');
		expect(stagingSecretsBlock).toContain('"APP_API_EXECUTION_SHARED_SECRET"');
		expect(stagingSecretsBlock).toContain('"OPS_WEB_INTERNAL_TOKEN"');
		expect(stagingSecretsBlock).not.toContain(
			JSON.stringify(retiredExecutionControlAccessClientIdKeyLocal),
		);
		expect(stagingSecretsBlock).not.toContain(
			JSON.stringify(retiredExecutionControlAccessClientSecretKeyLocal),
		);
		expect(stagingSecretsBlock).toContain('"APP_API_STAGING_SMOKE_AUTH_SECRET"');
		expect(stagingSecretsBlock).not.toContain('"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN"');
		expect(stagingSecretsBlock).not.toContain('"SENTRY_DSN"');
		expect(stagingSecretsBlock).not.toContain("APP_API_OTEL_INGEST_");
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
		expect(localSmokeWranglerConfig).not.toContain("APP_API_OTEL_INGEST_");
		expect(localSmokeWranglerConfig).not.toContain("127.0.0.1:8081");
	});

	it("keeps local smoke non-secret vars in config so .dev.vars only supplies secrets", () => {
		expect(localSmokeWranglerConfig).toContain("[secrets]");
		const localSmokeSecretsBlock = localSmokeWranglerConfig.split("[secrets]")[1] ?? "";
		expect(localSmokeSecretsBlock).toContain('"BETTER_AUTH_SECRET"');
		expect(localSmokeSecretsBlock).toContain('"AUTH_TURNSTILE_SECRET_KEY"');
		expect(localSmokeSecretsBlock).toContain('"RESEND_API_KEY"');
		expect(localSmokeSecretsBlock).not.toContain('"AUTH_RESET_EMAIL_FROM"');
		expect(localSmokeWranglerConfig).toContain(
			'AUTH_RESET_EMAIL_FROM = "Campus Agent <auth@example.com>"',
		);
		expect(localSmokeSecretsBlock).toContain('"APP_API_EXECUTION_SHARED_SECRET"');
		expect(localSmokeSecretsBlock).not.toContain('"EXECUTION_CONTROL_BASE_URL"');
		expect(localSmokeWranglerConfig).toContain('APP_API_ENVIRONMENT = "development"');
		expect(localSmokeWranglerConfig).toContain(
			'APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST = "example.edu"',
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
				database: "ready",
			},
		});
	});

	it("serves docs control-plane readiness separately from product runtime readiness", async () => {
		const runtime = createWorkerRuntime(env, {
			docsReadinessProbe: vi.fn().mockResolvedValue(createDocsReadinessResult()),
			runtimeReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "ready",
					database: "ready",
				},
				failed: {},
			}),
		});

		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/docs/readyz", {
				headers: { "x-campus-docs-release": docsReleaseId },
			}),
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
						"APP_API_DB_FRESH.connectionString",
						"BETTER_AUTH_SECRET",
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
					database: "ready",
				},
				failed: {
					auth: "better-auth session runtime failed probe",
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
					},
				},
			},
		});
	});
});
