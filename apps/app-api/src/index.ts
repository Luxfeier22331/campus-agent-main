import * as Sentry from "@sentry/cloudflare";

import { type AppDependencies, createApp } from "./app";
import { type Env, isDeployedEnvironment, resolveEnvironment } from "./config";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "./modules/integration";
import {
	buildProfileMemoryService,
	createPgProfileMemoryStore,
	type ProfileMemoryService,
} from "./modules/profile-memory";
import { createPgChatCommandStore, dispatchPendingChatAdmissions } from "./modules/runtime-command";
import { createAppTelemetry } from "./modules/telemetry";
import { createAppApiSentryOptions } from "./modules/telemetry/sentry";

export type { Env } from "./config";

export type WorkerRuntimeDependencies = AppDependencies;

interface WaitUntilContext {
	waitUntil(promise: Promise<unknown>): void;
}

interface WorkerRuntime {
	fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response;
	scheduled(): Promise<void>;
}

export function createWorkerRuntime(
	env: Env,
	dependencies: WorkerRuntimeDependencies = {},
): WorkerRuntime {
	const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
	let profileMemoryService: ProfileMemoryService | null = dependencies.profileMemoryService ?? null;
	function resolveProfileMemoryService(): ProfileMemoryService {
		if (profileMemoryService) {
			return profileMemoryService;
		}
		profileMemoryService = buildProfileMemoryService({
			commandAdmitter: createExecutionControlPersonalMemoryClient(env),
			store: createPgProfileMemoryStore(env),
		});
		return profileMemoryService;
	}
	const app = createApp(env, {
		...dependencies,
		telemetry,
	});

	return {
		fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response {
			return app.fetch(request, env, executionCtx as ExecutionContext | undefined);
		},
		async scheduled(): Promise<void> {
			if (isExecutionControlRuntimeConfigured(env)) {
				const result = dependencies.chatCommandService?.dispatchPendingAdmissions
					? await dependencies.chatCommandService.dispatchPendingAdmissions()
					: await dispatchPendingChatAdmissions({
							executionRuntime: createExecutionControlRuntimeClient(env),
							store: createPgChatCommandStore(env),
						});
				if (result.processed > 0) {
					console.info({ ...result, source: "app-api.chat-admission-dispatcher" });
				}
			}
			if (isExecutionControlRuntimeConfigured(env)) {
				const result = await Sentry.startSpan(
					{ name: "app-api.profile-memory.dispatch", op: "cron" },
					() => resolveProfileMemoryService().dispatchPending(),
				);
				if (result.processed > 0) {
					console.info({ ...result, source: "app-api.profile-memory-dispatcher" });
				}
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

export default Sentry.withSentry(createAppApiSentryOptions, worker);
