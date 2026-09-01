import { type AppDependencies, createApp } from "./app";
import { type Env, isDeployedEnvironment, resolveEnvironment } from "./config";
import { createPgAccountAdminStore } from "./modules/account-admin";
import {
	buildAccountLifecycleService,
	createPgAccountLifecycleStore,
} from "./modules/account-lifecycle";
import { getAppAuth } from "./modules/auth";
import { getOpsAccountAdminApi } from "./modules/auth/ops-account-admin-plugin";
import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
	type EmailAccessService,
} from "./modules/email-access";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "./modules/integration";
import {
	buildProfileMemoryService,
	createPgProfileMemoryPersistence,
	type ProfileMemoryService,
} from "./modules/profile-memory";
import { deriveSafetyIdentifierForUser } from "./modules/runtime-command";
import { runWithAppApiExecutionContext } from "./request-execution-context";

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
	let profileMemoryService: ProfileMemoryService | null = dependencies.profileMemoryService ?? null;
	let accountLifecycleService:
		| import("./modules/account-lifecycle").AccountLifecycleService
		| null = dependencies.accountLifecycleService ?? null;
	let emailAccessService: EmailAccessService | null = dependencies.emailAccessService ?? null;
	function resolveProfileMemoryService(): ProfileMemoryService {
		if (profileMemoryService) {
			return profileMemoryService;
		}
		const persistence = createPgProfileMemoryPersistence(env);
		profileMemoryService = buildProfileMemoryService({
			commandAdmitter: createExecutionControlPersonalMemoryClient(env),
			commandStore: persistence.commands,
			mutationStore: persistence.mutations,
			readStore: persistence.reads,
		});
		return profileMemoryService;
	}
	function resolveAccountLifecycleService() {
		if (accountLifecycleService) {
			return accountLifecycleService;
		}
		accountLifecycleService = buildAccountLifecycleService({
			executionController: createExecutionControlRuntimeClient(env),
			profileMemoryService: resolveProfileMemoryService(),
			removeAuthUser: async (userId) => {
				const auth = await getAppAuth(env);
				await getOpsAccountAdminApi(auth).opsRemoveUser({ body: { userId } });
			},
			safetyIdentifierForUser: (userId) =>
				deriveSafetyIdentifierForUser(userId, env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET ?? ""),
			store: createPgAccountLifecycleStore(env),
		});
		return accountLifecycleService;
	}
	function resolveEmailAccessService(): EmailAccessService {
		if (emailAccessService) {
			return emailAccessService;
		}
		emailAccessService = buildEmailAccessService({
			environment: resolveEnvironment(env),
			store: createPgEmailAccessGrantStore(env),
		});
		return emailAccessService;
	}
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
			if (isDeployedEnvironment(resolveEnvironment(env))) {
				const indeterminate = await createPgAccountAdminStore(env).markStaleCommandsIndeterminate(
					new Date(Date.now() - 5 * 60_000),
				);
				if (indeterminate > 0) {
					console.error({ indeterminate, source: "app-api.account-admin-reconciler" });
				}
			}
			if (isDeployedEnvironment(resolveEnvironment(env)) || dependencies.emailAccessService) {
				await resolveEmailAccessService().expire();
			}
			if (isExecutionControlRuntimeConfigured(env)) {
				await resolveProfileMemoryService().dispatchPending();
			}
			if (isExecutionControlRuntimeConfigured(env)) {
				await resolveAccountLifecycleService().dispatchPending();
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
