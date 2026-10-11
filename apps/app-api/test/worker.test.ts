import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import { readSubmissionCreate } from "../src/app/routes/dining-submission-request";
import { createWorkerRuntime } from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

interface WranglerEnvironment {
	hyperdrive?: Array<{ binding?: string; id?: string }>;
	observability?: unknown;
	routes?: unknown;
	secrets?: { required?: string[] };
	vars?: Record<string, string>;
	vpc_services?: Array<{ binding?: string; remote?: boolean; service_id?: string }>;
}

const parsedWranglerConfig = parse(wranglerConfig) as {
	env?: {
		local?: WranglerEnvironment;
		staging?: WranglerEnvironment;
	};
	observability?: unknown;
	preview_urls?: boolean;
	workers_dev?: boolean;
};

const env = {
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET: "safety-identifier-secret",
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	APP_API_DB: {
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

describe("app-api worker foundation", () => {
	it("runs the other scheduled owners even when memory dispatch fails", async () => {
		const dispatchMemory = vi.fn(async () => {
			throw new Error("memory unavailable");
		});
		const sweepDining = vi.fn(async () => undefined);
		const dispatchAccount = vi.fn(async () => ({ processed: 0 }));
		const expire = vi.fn(async () => 0);
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const runtime = createWorkerRuntime(env, {
				diningLifecycleService: { sweep: sweepDining, eraseForAccountDeletion: vi.fn() },
				profileMemoryService: {
					dispatchPending: dispatchMemory,
				} as unknown as import("../src/modules/profile-memory").ProfileMemoryService,
				accountLifecycleService: {
					dispatchPending: dispatchAccount,
				} as unknown as import("../src/modules/account-lifecycle").AccountLifecycleService,
				emailAccessService: {
					expire,
				} as unknown as import("../src/modules/email-access").EmailAccessService,
			});
			await expect(runtime.scheduled()).rejects.toThrow("Scheduled jobs failed");
			expect(sweepDining).toHaveBeenCalledOnce();
			expect(dispatchMemory).toHaveBeenCalledOnce();
			expect(dispatchAccount).toHaveBeenCalledOnce();
			expect(expire).toHaveBeenCalledOnce();
			expect(log).toHaveBeenCalledWith(
				expect.objectContaining({ job: "memory", error_code: "scheduled_job_failed" }),
			);
		} finally {
			log.mockRestore();
		}
	});

	it("runs Dining without execution-control configuration", async () => {
		const sweep = vi.fn(async () => undefined);
		await createWorkerRuntime(
			{ DEPLOYMENT_ENVIRONMENT: "test" },
			{
				diningLifecycleService: { sweep, eraseForAccountDeletion: vi.fn() },
			},
		).scheduled();
		expect(sweep).toHaveBeenCalledOnce();
	});

	it.each(["call", "initialization"])(
		"continues the remaining jobs after Dining %s fails",
		async (failure) => {
			const dispatchPending = vi.fn(async () => ({ processed: 0 }));
			const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
			try {
				const runtime = createWorkerRuntime(
					{ ...env, APP_API_DB: { connectionString: "" } },
					{
						...(failure === "call"
							? {
									diningLifecycleService: {
										sweep: async () => {
											throw new Error("storage unavailable");
										},
										eraseForAccountDeletion: vi.fn(),
									},
								}
							: {}),
						profileMemoryService: {
							dispatchPending,
						} as unknown as import("../src/modules/profile-memory").ProfileMemoryService,
						accountLifecycleService: {
							dispatchPending,
						} as unknown as import("../src/modules/account-lifecycle").AccountLifecycleService,
					},
				);
				await expect(runtime.scheduled()).rejects.toThrow("Scheduled jobs failed");
				expect(dispatchPending).toHaveBeenCalledTimes(2);
				expect(log).toHaveBeenCalledWith(
					expect.objectContaining({ job: "dining", error_code: "scheduled_job_failed" }),
				);
			} finally {
				log.mockRestore();
			}
		},
	);

	it("reads submission multipart metadata and original file bytes in the Worker runtime", async () => {
		const form = new FormData();
		form.append(
			"metadata",
			JSON.stringify({ name: " 面 ", priceText: null, photoAction: "replace" }),
		);
		form.append("photo", new Blob([new Uint8Array([0, 255, 1])]), "photo.png");
		const request = new Request(
			"https://app-api.internal/api/dining/windows/window_1/submissions",
			{ method: "POST", body: form },
		);
		await expect(readSubmissionCreate(request)).resolves.toEqual({
			metadata: { name: "面", priceText: null, photoAction: "replace" },
			photo: new Uint8Array([0, 255, 1]),
		});
	});

	it("serves submission reviews through the Worker without caching viewer actions", async () => {
		const listSubmissionReviews = vi.fn(async () => ({ items: [], nextCursor: null }));
		const runtime = createWorkerRuntime(env, {
			diningContentService: {
				listSubmissionReviews,
			} as unknown as import("../src/modules/dining").DiningContentService,
			getPrincipal: vi.fn(async () => null),
		});
		const response = await runtime.fetch(
			new Request("https://app-api.internal/api/dining/submissions/dsu_1/reviews?limit=5"),
			createExecutionContext(),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ items: [], nextCursor: null });
		expect(listSubmissionReviews).toHaveBeenCalledWith({
			submissionId: "dsu_1",
			limit: 5,
			viewerUserId: null,
		});
	});

	it("supports standard regular expression escaping", () => {
		const literal = "a-b.c";
		const pattern = new RegExp(`^${RegExp.escape(literal)}$`, "u");

		expect(pattern.test(literal)).toBe(true);
		expect(pattern.test("axb-c")).toBe(false);
	});

	it("leaves Worker observability ownership to GitOps", () => {
		expect(parsedWranglerConfig.observability).toBeUndefined();
		expect(parsedWranglerConfig.env?.staging).not.toHaveProperty("observability");
	});

	it("leaves scheduled trigger ownership to GitOps", () => {
		expect(parsedWranglerConfig).not.toHaveProperty("triggers");
		expect(parsedWranglerConfig.env?.staging).not.toHaveProperty("triggers");
	});

	it("keeps traffic out of Wrangler and declares staging bindings", () => {
		const staging = parsedWranglerConfig.env?.staging;
		expect(staging).toBeDefined();
		expect(parsedWranglerConfig.workers_dev).toBe(false);
		expect(parsedWranglerConfig.preview_urls).toBe(false);
		expect(staging).not.toHaveProperty("routes");
		expect(staging?.vars).toMatchObject({
			AUTH_SHELL_ORIGIN: "https://campus-staging.mucwiki-edge.link",
			DEPLOYMENT_ENVIRONMENT: "staging",
			EXECUTION_CONTROL_PRIVATE_ORIGIN:
				"http://execution-control.campus-agent-staging.svc.cluster.local:8000",
		});
		expect(staging?.vars).not.toHaveProperty("EXECUTION_CONTROL_BASE_URL");
		expect(staging?.hyperdrive).toEqual([expect.objectContaining({ binding: "APP_API_DB" })]);
		expect(staging?.vpc_services).toEqual([
			expect.objectContaining({ binding: "EXECUTION_CONTROL_PRIVATE", remote: true }),
			expect.objectContaining({ binding: "MEMORY_SERVICE_PRIVATE", remote: true }),
			expect.objectContaining({ binding: "OBJECT_STORE_PRIVATE", remote: true }),
		]);
	});

	it("declares the required local and staging secrets", () => {
		const requiredSecrets = [
			"BETTER_AUTH_SECRET",
			"AUTH_TURNSTILE_SECRET_KEY",
			"RESEND_API_KEY",
			"OPS_WEB_INTERNAL_TOKEN",
			"APP_API_EXECUTION_SHARED_SECRET",
			"MEMORY_INTERNAL_SHARED_SECRET",
			"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET",
			"OBJECT_STORE_DERIVED_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_SECRET_KEY",
			"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
		];
		expect(parsedWranglerConfig.env?.local?.secrets?.required).toEqual(requiredSecrets);
		expect(parsedWranglerConfig.env?.staging?.secrets?.required).toEqual(requiredSecrets);
		expect(parsedWranglerConfig.env?.local?.vars).toMatchObject({
			AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
			AUTH_SHELL_ORIGIN: "http://127.0.0.1:27014",
		});
	});

	it("declares the local database binding without freezing a runtime port", () => {
		expect(parsedWranglerConfig.env?.local?.hyperdrive).toEqual([
			expect.objectContaining({ binding: "APP_API_DB" }),
		]);
		expect(parsedWranglerConfig.env?.local?.vars).not.toHaveProperty("EXECUTION_CONTROL_BASE_URL");
	});

	it("serves healthz and readyz from the worker shell", async () => {
		const runtime = createWorkerRuntime(env, {
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

	it("fails readyz closed when required config is missing", async () => {
		const runtime = createWorkerRuntime(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
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
				requestId: null,
				details: {
					missing: [
						"APP_API_DB.connectionString",
						"BETTER_AUTH_SECRET",
						"AUTH_TURNSTILE_SECRET_KEY",
						"AUTH_SHELL_ORIGIN",
						"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET",
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
