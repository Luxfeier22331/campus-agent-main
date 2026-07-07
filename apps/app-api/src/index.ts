import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { type AppDependencies, createApp } from "./app";
import {
	type Env,
	isDeployedEnvironment,
	readPublicNoticeURLAllowlist,
	resolveAppName,
	resolveEnvironment,
} from "./config";
import { AppApiRouteError } from "./http";
import { createPgChatConversationStore } from "./modules/chat";
import {
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "./modules/integration";
import {
	buildRequestProjectionProjector,
	createPgProjectionStore,
	type RequestProjectionProjector,
} from "./modules/projection";
import {
	buildChatCommandService,
	type ChatCommandService,
	createPgChatCommandStore,
} from "./modules/runtime-command";
import { createAppTelemetry } from "./modules/telemetry";

export type { Env } from "./config";

export interface WorkerRuntimeDependencies extends AppDependencies {
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

function isExplicitlyEnabled(value: string | undefined): boolean {
	return value?.trim().toLowerCase() === "true";
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
	let durableCloseoutService = dependencies.chatCommandService ?? null;
	function resolveDurableCloseoutService(): ChatCommandService {
		if (durableCloseoutService) {
			return durableCloseoutService;
		}
		if (resolveEnvironment(env) === "test") {
			durableCloseoutService = {
				async reconcileDurableCloseouts() {
					return { failed: 0, finalized: 0, scanned: 0 };
				},
				async submit() {
					throw new AppApiRouteError({
						code: "dependency_not_ready",
						message: "Chat command service is not configured.",
						retryable: true,
						status: 503,
					});
				},
			};
			return durableCloseoutService;
		}
		const executionRuntime = isExecutionControlRuntimeConfigured(env)
			? createExecutionControlRuntimeClient(env)
			: undefined;
		durableCloseoutService = buildChatCommandService({
			conversationStore: createPgChatConversationStore(env),
			executionRuntime,
			isExecutionRuntimeConfigured: Boolean(executionRuntime),
			publicNoticeURLAllowlist: readPublicNoticeURLAllowlist(env),
			store: createPgChatCommandStore(env),
			telemetry,
		});
		return durableCloseoutService;
	}
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
			const closeoutResult = isExplicitlyEnabled(env.APP_API_DURABLE_CLOSEOUT_SWEEPER_ENABLED)
				? await Sentry.startSpan(
						{
							name: "app-api.durable-closeout.reconcile",
							op: "cron",
						},
						() =>
							resolveDurableCloseoutService().reconcileDurableCloseouts?.() ??
							Promise.resolve(null),
					)
				: null;
			const requestResult = isExplicitlyEnabled(env.APP_API_REQUEST_PROJECTION_SWEEPER_ENABLED)
				? await drainRequestProjection({
						op: "cron",
						requestProjector,
						telemetry,
					})
				: { failed: 0, processed: 0 };
			if (requestResult.processed > 0) {
				console.info(
					JSON.stringify({
						failed: requestResult.failed,
						processed: requestResult.processed,
						source: "app-api.request-projection-projector",
					}),
				);
			}
			if (closeoutResult && (closeoutResult.finalized > 0 || closeoutResult.failed > 0)) {
				console.info(
					JSON.stringify({
						failed: closeoutResult.failed,
						finalized: closeoutResult.finalized,
						scanned: closeoutResult.scanned,
						source: "app-api.durable-closeout-reconciler",
					}),
				);
			}
			if (closeoutResult && closeoutResult.failed > 0) {
				console.error(
					JSON.stringify({
						failed: closeoutResult.failed,
						finalized: closeoutResult.finalized,
						scanned: closeoutResult.scanned,
						source: "app-api.durable-closeout-reconciler",
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
