import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { type AppDependencies, createApp } from "./app";
import { type Env, isDeployedEnvironment, resolveAppName, resolveEnvironment } from "./config";
import { AppApiRouteError } from "./http";
import { createOfficialWebHandoffPublisher } from "./modules/integration";
import {
	buildOfficialWebProjectionProjector,
	createPgOfficialWebProjectionStore,
	type OfficialWebProjectionProjector,
} from "./modules/official-web-projection";
import {
	buildRequestProjectionProjector,
	createPgProjectionStore,
	type RequestProjectionProjector,
} from "./modules/projection";
import { createAppTelemetry } from "./modules/telemetry";

export type { Env } from "./config";

export interface WorkerRuntimeDependencies extends AppDependencies {
	officialWebProjector?: OfficialWebProjectionProjector;
	requestProjector?: RequestProjectionProjector;
}

interface WaitUntilContext {
	waitUntil(promise: Promise<unknown>): void;
}

interface WorkerRuntime {
	fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response;
	scheduled(): Promise<void>;
}

const SENSITIVE_EVENT_FIELDS = new Set([
	"answer",
	"authorization",
	"cf-access-jwt-assertion",
	"cookie",
	"operator_email",
	"prompt",
	"transcript",
	"x-app-internal-auth",
	"x-app-operator-email",
	"x-worker-origin-auth",
]);

function scrubSensitiveRecord(value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return;
	}

	for (const key of Object.keys(value as Record<string, unknown>)) {
		if (SENSITIVE_EVENT_FIELDS.has(key.toLowerCase())) {
			delete (value as Record<string, unknown>)[key];
		}
	}
}

function createSentryOptions(env: Env): CloudflareOptions | undefined {
	const dsn = env.SENTRY_DSN?.trim();
	if (!dsn) {
		return;
	}

	return {
		dsn,
		environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
		initialScope: {
			tags: {
				app: resolveAppName(env),
				runtime: "cloudflare-worker",
				surface: "app_api",
			},
		},
		release: env.SENTRY_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampleRate: 1,
		beforeSend(event) {
			scrubSensitiveRecord(event.request?.headers);
			scrubSensitiveRecord(event.request?.data);
			scrubSensitiveRecord(event.contexts?.trace);
			scrubSensitiveRecord(event.extra);
			if (event.user) {
				delete event.user.email;
				delete event.user.ip_address;
				delete event.user.username;
			}
			return event;
		},
	};
}

async function drainRequestProjection(input: {
	op: "cron" | "task";
	requestProjector: RequestProjectionProjector;
	telemetry: ReturnType<typeof createAppTelemetry>;
}) {
	const result = await Sentry.startSpan(
		{
			name: "app-api.request-projection.drain",
			op: input.op,
		},
		() => input.requestProjector.drain(),
	);
	if (result.processed > 0 || result.failed > 0) {
		await input.telemetry.recordProjectionDrain({
			failed: result.failed,
			processed: result.processed,
			projector: "request_projection",
			projectorLastErrorCode: result.failed > 0 ? "projection_failed" : null,
			surface: "app_api",
		});
	}

	return result;
}

export function createWorkerRuntime(
	env: Env,
	dependencies: WorkerRuntimeDependencies = {},
): WorkerRuntime {
	const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
	const requestProjector =
		dependencies.requestProjector ??
		buildRequestProjectionProjector({
			store: createPgProjectionStore(env),
		});
	const officialWebProjector =
		dependencies.officialWebProjector ??
		buildOfficialWebProjectionProjector({
			handoffPublisher: createOfficialWebHandoffPublisher(env),
			store: createPgOfficialWebProjectionStore(env),
		});
	const scheduleRequestProjectionDrain =
		dependencies.scheduleRequestProjectionDrain ??
		((input: {
			requestId: string;
			waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
		}) => {
			if (!input.waitUntil) {
				throw new AppApiRouteError({
					code: "request_projection_scheduler_unavailable",
					message: "Request projection drain requires executionCtx.waitUntil.",
					retryable: true,
					status: 503,
				});
			}

			const runDrain = Promise.resolve().then(async () => {
				try {
					const result = await Sentry.startSpan(
						{
							name: "app-api.request-projection.drain",
							op: "task",
						},
						() => requestProjector.drainRequest(input.requestId),
					);
					if (result.processed > 0 || result.failed > 0) {
						await telemetry.recordProjectionDrain({
							failed: result.failed,
							processed: result.processed,
							projector: "request_projection",
							projectorLastErrorCode: result.failed > 0 ? "projection_failed" : null,
							surface: "app_api",
						});
					}
				} catch (error) {
					telemetry.captureException(error, {
						route: "/api/chat/requests",
						surface: "app_api",
					});
					console.error(
						JSON.stringify({
							error:
								error instanceof Error
									? {
											message: error.message,
											name: error.name,
										}
									: {
											message: String(error),
											name: "UnknownError",
										},
							requestId: input.requestId,
							source: "app-api.request-projection-projector.background",
						}),
					);
				}
			});

			input.waitUntil(runDrain);
		});
	const app = createApp(env, {
		...dependencies,
		scheduleRequestProjectionDrain,
		telemetry,
	});

	return {
		fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response {
			return app.fetch(request, env, executionCtx as ExecutionContext | undefined);
		},
		async scheduled(): Promise<void> {
			const requestResult = await drainRequestProjection({
				op: "cron",
				requestProjector,
				telemetry,
			});
			const officialWebResult = await Sentry.startSpan(
				{
					name: "app-api.official-web-projection.drain",
					op: "cron",
				},
				() => officialWebProjector.drain(),
			);
			if (
				officialWebResult.processed > 0 ||
				officialWebResult.failed > 0 ||
				officialWebResult.abandoned > 0
			) {
				await telemetry.recordProjectionDrain({
					abandoned: officialWebResult.abandoned,
					failed: officialWebResult.failed,
					processed: officialWebResult.processed,
					projector: "official_web_projection",
					projectorLastErrorCode: officialWebResult.failed > 0 ? "projection_failed" : null,
					surface: "official_web",
				});
			}
			if (requestResult.processed > 0) {
				console.info(
					JSON.stringify({
						failed: requestResult.failed,
						processed: requestResult.processed,
						source: "app-api.request-projection-projector",
					}),
				);
			}
			if (requestResult.failed > 0) {
				console.error(
					JSON.stringify({
						failed: requestResult.failed,
						processed: requestResult.processed,
						source: "app-api.request-projection-projector",
					}),
				);
			}
			if (officialWebResult.processed > 0 || officialWebResult.abandoned > 0) {
				console.info(
					JSON.stringify({
						abandoned: officialWebResult.abandoned,
						failed: officialWebResult.failed,
						processed: officialWebResult.processed,
						source: "app-api.official-web-projection-projector",
					}),
				);
			}
			if (officialWebResult.failed > 0) {
				console.error(
					JSON.stringify({
						abandoned: officialWebResult.abandoned,
						failed: officialWebResult.failed,
						processed: officialWebResult.processed,
						source: "app-api.official-web-projection-projector",
					}),
				);
			}
		},
	};
}

const runtimeCache = new WeakMap<Env, WorkerRuntime>();

function shouldCacheWorkerRuntime(env: Env): boolean {
	const environment = resolveEnvironment(env);
	return environment === "test" || isDeployedEnvironment(environment);
}

function resolveWorkerRuntime(env: Env): WorkerRuntime {
	if (!shouldCacheWorkerRuntime(env)) {
		return createWorkerRuntime(env);
	}

	const cachedRuntime = runtimeCache.get(env);
	if (cachedRuntime) {
		return cachedRuntime;
	}

	const runtime = createWorkerRuntime(env);
	runtimeCache.set(env, runtime);
	return runtime;
}

const worker = {
	fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> | Response {
		return resolveWorkerRuntime(env).fetch(request, executionCtx);
	},
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		await resolveWorkerRuntime(env).scheduled();
	},
};

export default Sentry.withSentry(createSentryOptions, worker);
