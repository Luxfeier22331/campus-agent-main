import { type AppDependencies, createApp } from "./app";
import { createRequestScopeFactory } from "./app/request-scope";
import { type Env, isDeployedEnvironment, resolveEnvironment } from "./config";
import { createPgAccountAdminStore } from "./modules/account-admin";
import { isExecutionControlRuntimeConfigured } from "./modules/integration";
import { runWithAppApiExecutionContext } from "./request-execution-context";
import {
	reportRuntimeFailure,
	safeRuntimeFailure,
	withScheduledDiagnostics,
} from "./runtime-diagnostics";

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
	const { chatCommandService, runtimeRunService, ...requestDependencies } = dependencies;
	const app = createApp(env, {
		...requestDependencies,
		...(chatCommandService && runtimeRunService ? { chatCommandService, runtimeRunService } : {}),
	});

	return {
		fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response {
			return runWithAppApiExecutionContext(executionCtx, () =>
				app.fetch(request, env, executionCtx as ExecutionContext | undefined),
			);
		},
		async scheduled(): Promise<void> {
			const scope = createRequestScopeFactory({ env, dependencies }).createRequestScope();
			const jobs: { name: string; run: () => Promise<unknown> }[] = [];
			if (isDeployedEnvironment(resolveEnvironment(env))) {
				jobs.push({
					name: "account-admin",
					run: async () => {
						const indeterminate = await createPgAccountAdminStore(env, {
							getDb: scope.getDb,
						}).markStaleCommandsIndeterminate(new Date(Date.now() - 5 * 60_000));
						if (indeterminate > 0) {
							console.error({ indeterminate, source: "app-api.account-admin-reconciler" });
						}
					},
				});
			}
			if (isDeployedEnvironment(resolveEnvironment(env)) || dependencies.emailAccessService) {
				jobs.push({ name: "email-access", run: () => scope.resolveEmailAccessService().expire() });
			}
			jobs.push({ name: "dining", run: () => scope.resolveDiningLifecycleService().sweep() });
			if (isExecutionControlRuntimeConfigured(env)) {
				jobs.push({
					name: "memory",
					run: async () => {
						const service = scope.resolveProfileMemoryService();
						const dispatch = await service.dispatchPending();
						const reconcile = service.reconcileAdmitted
							? await service.reconcileAdmitted()
							: { reconciled: 0, failed: 0, processed: 0 };
						const retry = service.retryFailedLifecycleCommands
							? await service.retryFailedLifecycleCommands()
							: { retried: 0, failed: 0, processed: 0 };
						return { dispatch, reconcile, retry };
					},
				});
				jobs.push({
					name: "account-lifecycle",
					run: () => scope.resolveAccountLifecycleService().dispatchPending(),
				});
			}
			const results = await Promise.allSettled(
				jobs.map((job) =>
					withScheduledDiagnostics(job.name, async () => {
						try {
							return await job.run();
						} catch (error) {
							reportRuntimeFailure(error, {
								source: "app-api.scheduled",
								error_code: "scheduled_job_failed",
							});
							throw safeRuntimeFailure(error, "app-api.scheduled");
						}
					}),
				),
			);
			const errors: unknown[] = [];
			for (const result of results) {
				if (result.status === "rejected") {
					errors.push(result.reason);
				}
			}

			if (errors.length > 0) {
				throw new AggregateError(errors, "Scheduled jobs failed");
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

export default worker;
