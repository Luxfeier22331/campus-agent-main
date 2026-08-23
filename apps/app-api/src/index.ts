import * as Sentry from "@sentry/cloudflare";

import { type AppDependencies, createApp } from "./app";
import { type Env, isDeployedEnvironment, resolveEnvironment } from "./config";
import { createPgAccountAdminStore } from "./modules/account-admin";
import {
	buildAccountLifecycleService,
	createPgAccountLifecycleStore,
} from "./modules/account-lifecycle";
import { getAppAuth } from "./modules/auth";
import { getOpsAccountAdminApi } from "./modules/auth/ops-account-admin-plugin";
import { createPgChatConversationStore } from "./modules/chat";
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
import {
	buildChatCommandService,
	type ChatCommandService,
	createPgChatCommandPersistence,
	deriveSafetyIdentifierForUser,
} from "./modules/runtime-command";
import {
	buildRuntimeRunService,
	createPgRuntimeRunStore,
	type RuntimeRunService,
} from "./modules/runtime-run";
import { createAppTelemetry } from "./modules/telemetry";
import { createAppApiSentryOptions } from "./modules/telemetry/sentry";
import { runWithAppApiExecutionContext } from "./request-execution-context";

export type { Env } from "./config";

type ScheduledRuntimeDependencies =
	| { chatCommandService?: undefined; runtimeRunService?: undefined }
	| { chatCommandService: ChatCommandService; runtimeRunService: RuntimeRunService };

export type WorkerRuntimeDependencies = Omit<
	AppDependencies,
	"chatCommandService" | "runtimeRunService"
> &
	ScheduledRuntimeDependencies;

interface WaitUntilContext {
	waitUntil(promise: Promise<unknown>): void;
}

interface WorkerRuntime {
	fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response;
	scheduled(): Promise<void>;
}

function scheduledErrorDetails(error: unknown): Record<string, string> {
	if (error instanceof Error) {
		return {
			message: error.message,
			name: error.name,
		};
	}
	return { message: String(error), name: "UnknownError" };
}

async function runScheduledSweep(name: string, sweep: () => Promise<void>): Promise<void> {
	try {
		await sweep();
	} catch (error) {
		console.error({
			error: scheduledErrorDetails(error),
			source: "app-api.scheduled",
			task: name,
		});
	}
}

export function createWorkerRuntime(
	env: Env,
	dependencies: WorkerRuntimeDependencies = {},
): WorkerRuntime {
	if (
		(dependencies.chatCommandService === undefined) !==
		(dependencies.runtimeRunService === undefined)
	) {
		throw new Error("Scheduled chat command and runtime run services must be configured together.");
	}
	const telemetry = dependencies.telemetry ?? createAppTelemetry();
	let profileMemoryService: ProfileMemoryService | null = dependencies.profileMemoryService ?? null;
	let scheduledRuntimeServices: {
		chatCommandService: ChatCommandService;
		runtimeRunService: RuntimeRunService;
	} | null = null;
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
	function resolveScheduledRuntimeServices(
		executionRuntime: ReturnType<typeof createExecutionControlRuntimeClient>,
	) {
		if (scheduledRuntimeServices) {
			return scheduledRuntimeServices;
		}
		if (dependencies.chatCommandService && dependencies.runtimeRunService) {
			scheduledRuntimeServices = {
				chatCommandService: dependencies.chatCommandService,
				runtimeRunService: dependencies.runtimeRunService,
			};
			return scheduledRuntimeServices;
		}
		const commandPersistence = createPgChatCommandPersistence(env);
		const chatCommandService = buildChatCommandService({
			admissionStore: commandPersistence.admission,
			commandStore: commandPersistence.commands,
			conversationStore: createPgChatConversationStore(env),
			executionRuntime,
			isExecutionRuntimeConfigured: true,
			observabilityStore: commandPersistence.observability,
			...(env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET
				? { safetyIdentifierHmacSecret: env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET }
				: {}),
			telemetry,
		});
		scheduledRuntimeServices = {
			chatCommandService,
			runtimeRunService: buildRuntimeRunService({
				executionRuntime,
				finalizeLocalCancellation: async (cancellation) => {
					if (!chatCommandService.finalizeLocalCancellation) {
						throw new Error("Local chat cancellation finalization is not configured.");
					}
					await chatCommandService.finalizeLocalCancellation(cancellation);
				},
				store: createPgRuntimeRunStore(env),
			}),
		};
		return scheduledRuntimeServices;
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
		telemetry,
	});

	return {
		fetch(request: Request, executionCtx?: WaitUntilContext): Promise<Response> | Response {
			return runWithAppApiExecutionContext(executionCtx, () =>
				app.fetch(request, env, executionCtx as ExecutionContext | undefined),
			);
		},
		async scheduled(): Promise<void> {
			const deployed = isDeployedEnvironment(resolveEnvironment(env));
			const executionConfigured = isExecutionControlRuntimeConfigured(env);

			await runScheduledSweep("account-admin.stale-commands", async () => {
				if (!deployed) {
					return;
				}
				const indeterminate = await createPgAccountAdminStore(env).markStaleCommandsIndeterminate(
					new Date(Date.now() - 5 * 60_000),
				);
				if (indeterminate > 0) {
					console.error({ indeterminate, source: "app-api.account-admin-reconciler" });
				}
			});

			await runScheduledSweep("email-access.expire", async () => {
				if (!(deployed || dependencies.emailAccessService)) {
					return;
				}
				await resolveEmailAccessService().expire();
			});

			if (executionConfigured) {
				await runScheduledSweep("chat.admission", async () => {
					const { chatCommandService } = resolveScheduledRuntimeServices(
						createExecutionControlRuntimeClient(env),
					);
					if (!chatCommandService.dispatchPendingAdmissions) {
						throw new Error("Chat admission product finalization is not configured.");
					}
					await chatCommandService.dispatchPendingAdmissions();
				});

				await runScheduledSweep("runtime-run.cancellation", async () => {
					const { runtimeRunService } = resolveScheduledRuntimeServices(
						createExecutionControlRuntimeClient(env),
					);
					if (!runtimeRunService.dispatchPendingCancellations) {
						throw new Error("Run cancellation dispatcher is not configured.");
					}
					await runtimeRunService.dispatchPendingCancellations();
				});

				await runScheduledSweep("profile-memory.dispatch", async () => {
					await resolveProfileMemoryService().dispatchPending();
				});

				await runScheduledSweep("account-lifecycle.dispatch", async () => {
					await resolveAccountLifecycleService().dispatchPending();
				});
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
