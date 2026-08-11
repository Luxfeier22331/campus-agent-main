import { type Env, readAppAuthConfig, resolveEnvironment } from "../config";
import { buildAccountAdminService, createPgAccountAdminStore } from "../modules/account-admin";
import {
	buildAccountLifecycleService,
	createPgAccountLifecycleStore,
} from "../modules/account-lifecycle";
import { getOpsAccountAdminApi } from "../modules/auth/ops-account-admin-plugin";
import { buildCampusExperienceService } from "../modules/campus-experience";
import { buildCampusGroupsService, createPgCampusGroupsStore } from "../modules/campus-groups";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import {
	buildChatAvailabilityService,
	createPgChatAvailabilityStore,
} from "../modules/chat-availability";
import { createPgDiningContentService, createPgDiningMapReadService } from "../modules/dining";
import { buildEmailAccessService, createPgEmailAccessGrantStore } from "../modules/email-access";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "../modules/integration";
import { buildProfileMemoryService, createPgProfileMemoryStore } from "../modules/profile-memory";
import {
	buildChatCommandService,
	createPgChatCommandStore,
	deriveSafetyIdentifierForUser,
} from "../modules/runtime-command";
import { buildRuntimeRunService, createPgRuntimeRunStore } from "../modules/runtime-run";
import { createRequestRuntimeScope } from "../request-runtime-scope";
import type { AppDependencies, AppRequestScope } from "./types";

export function createRequestScopeFactory(input: {
	dependencies: AppDependencies;
	env: Env;
	telemetry: import("../modules/telemetry").AppTelemetry;
}) {
	const executionRuntimeConfigured = isExecutionControlRuntimeConfigured(input.env);
	const executionRuntime = executionRuntimeConfigured
		? createExecutionControlRuntimeClient(input.env)
		: undefined;
	return {
		createRequestScope(): AppRequestScope {
			const runtime = createRequestRuntimeScope(input.env);
			const getAppAuth = input.dependencies.getAppAuth ?? runtime.getAppAuth;
			let accountAdmin = input.dependencies.accountAdminService ?? null;
			let accountLifecycle = input.dependencies.accountLifecycleService ?? null;
			let campusExperience = input.dependencies.campusExperienceService ?? null;
			let campusGroups = input.dependencies.campusGroupsService ?? null;
			let chatAvailability = input.dependencies.chatAvailabilityService ?? null;
			let chat = input.dependencies.chatConversationService ?? null;
			let command = input.dependencies.chatCommandService ?? null;
			let dining = input.dependencies.diningMapReadService ?? null;
			let diningContent = input.dependencies.diningContentService ?? null;
			let emailAccess = input.dependencies.emailAccessService ?? null;
			let memory = input.dependencies.profileMemoryService ?? null;
			let runtimeRuns = input.dependencies.runtimeRunService ?? null;
			const resolveProfileMemoryService = () =>
				(memory ??= buildProfileMemoryService({
					commandAdmitter: createExecutionControlPersonalMemoryClient(input.env),
					store: createPgProfileMemoryStore(input.env, { getDb: runtime.getDb }),
				}));
			const resolveChatConversationService = () =>
				(chat ??= buildChatConversationService({
					detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getDb }),
					dispatchMemoryCommands: () => resolveProfileMemoryService().dispatchPending(),
					store: createPgChatConversationStore(input.env, { getDb: runtime.getDb }),
				}));
			const resolveChatCommandService = () =>
				(command ??= buildChatCommandService({
					conversationStore: createPgChatConversationStore(input.env, {
						getDb: runtime.getDb,
					}),
					executionRuntime,
					isExecutionRuntimeConfigured: executionRuntimeConfigured,
					profileMemoryStore: createPgProfileMemoryStore(input.env, { getDb: runtime.getDb }),
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getDb }),
					telemetry: input.telemetry,
				}));
			return {
				getAppAuth,
				resolveAccountAdminService: () =>
					(accountAdmin ??= buildAccountAdminService({
						authOrigin: new URL(readAppAuthConfig(input.env).authShellOrigin).origin,
						getAppAuth,
						store: createPgAccountAdminStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveAccountLifecycleService: () =>
					(accountLifecycle ??= buildAccountLifecycleService({
						profileMemoryService: resolveProfileMemoryService(),
						removeAuthUser: async (userId) => {
							const auth = await getAppAuth();
							await getOpsAccountAdminApi(auth).opsRemoveUser({ body: { userId } });
						},
						safetyIdentifierForUser: (userId) =>
							deriveSafetyIdentifierForUser(
								userId,
								input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET ?? "",
							),
						store: createPgAccountLifecycleStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveCampusExperienceService: () => (campusExperience ??= buildCampusExperienceService()),
				resolveCampusGroupsService: () =>
					(campusGroups ??= buildCampusGroupsService(
						createPgCampusGroupsStore(input.env, { getDb: runtime.getDb }),
					)),
				resolveChatAvailabilityService: () =>
					(chatAvailability ??= buildChatAvailabilityService({
						store: createPgChatAvailabilityStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDiningMapReadService: () =>
					(dining ??= createPgDiningMapReadService(input.env, {
						getDb: runtime.getDb,
					})),
				resolveDiningContentService: () =>
					(diningContent ??= createPgDiningContentService(input.env, {
						getDb: runtime.getDb,
					})),
				resolveEmailAccessService: () =>
					(emailAccess ??= buildEmailAccessService({
						environment: resolveEnvironment(input.env),
						store: createPgEmailAccessGrantStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveProfileMemoryService,
				resolveRuntimeRunService: () =>
					(runtimeRuns ??= buildRuntimeRunService({
						executionRuntime: createExecutionControlRuntimeClient(input.env),
						finalizeLocalCancellation: async (cancellation) => {
							const service = resolveChatCommandService();
							if (!service.finalizeLocalCancellation) {
								throw new Error("Local chat cancellation finalization is not configured.");
							}
							await service.finalizeLocalCancellation(cancellation);
						},
						store: createPgRuntimeRunStore(input.env, { getDb: runtime.getDb }),
					})),
				telemetry: input.telemetry,
			};
		},
	};
}
