import { type Env, readAppAuthConfig, resolveEnvironment } from "../config";
import { isAbuseThrottleEnabled } from "../modules/abuse-throttle-policy";
import { buildAccountAdminService, createPgAccountAdminStore } from "../modules/account-admin";
import {
	buildAccountLifecycleService,
	createPgAccountLifecycleStore,
} from "../modules/account-lifecycle";
import { getOpsAccountAdminApi } from "../modules/auth/ops-account-admin-plugin";
import { buildCampusExperienceService } from "../modules/campus-experience";
import { buildCampusGroupsService, createPgCampusGroupsStore } from "../modules/campus-groups";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import { createChatFeedbackQueryService } from "../modules/chat/feedback-query";
import { createOpsConversationQueryService } from "../modules/chat/ops-conversation-query";
import {
	buildChatAvailabilityService,
	createPgChatAvailabilityStore,
} from "../modules/chat-availability";
import {
	createPgDiningContentService,
	createPgDiningLifecycleService,
	createPgDiningMapReadService,
	createPgDiningSubmissionService,
} from "../modules/dining";
import { buildEmailAccessService, createPgEmailAccessGrantStore } from "../modules/email-access";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "../modules/integration";
import {
	buildNoticeService,
	createNoticeObjectStore,
	createPgNoticeStore,
} from "../modules/notices";
import {
	buildProfileMemoryService,
	createPgProfileMemoryPersistence,
} from "../modules/profile-memory";
import {
	buildChatCommandService,
	createPgChatCommandPersistence,
	deriveSafetyIdentifierForUser,
} from "../modules/runtime-command";
import { ensureDurableRunForStoredInput } from "../modules/runtime-command/service/durable-run";
import { buildRuntimeRunService, createPgRuntimeRunStore } from "../modules/runtime-run";
import { createPgTransportScheduleService } from "../modules/transport";
import { createRequestRuntimeScope } from "../request-runtime-scope";
import type { AppDependencies, AppRequestScope } from "./types";

export function createRequestScopeFactory(input: { dependencies: AppDependencies; env: Env }) {
	const executionRuntimeConfigured = isExecutionControlRuntimeConfigured(input.env);
	const executionRuntime = executionRuntimeConfigured
		? createExecutionControlRuntimeClient(input.env)
		: undefined;
	return {
		createRequestScope(): AppRequestScope {
			const runtime = createRequestRuntimeScope(
				input.env,
				input.dependencies.runtimeScopeDependencies,
			);
			const getAppAuth = input.dependencies.getAppAuth ?? runtime.getAppAuth;
			let accountAdmin = input.dependencies.accountAdminService ?? null;
			let accountLifecycle = input.dependencies.accountLifecycleService ?? null;
			let campusExperience = input.dependencies.campusExperienceService ?? null;
			let campusGroups = input.dependencies.campusGroupsService ?? null;
			let chatAvailability = input.dependencies.chatAvailabilityService ?? null;
			let chat = input.dependencies.chatConversationService ?? null;
			let opsConversationQuery = input.dependencies.opsConversationQueryService ?? null;
			let feedbackQuery = input.dependencies.chatFeedbackQueryService ?? null;
			let command = input.dependencies.chatCommandService ?? null;
			let chatCommandPersistence: ReturnType<typeof createPgChatCommandPersistence> | null = null;
			let dining = input.dependencies.diningMapReadService ?? null;
			let diningContent = input.dependencies.diningContentService ?? null;
			let diningLifecycle = input.dependencies.diningLifecycleService ?? null;
			let diningSubmissions = input.dependencies.diningSubmissionService ?? null;
			let emailAccess = input.dependencies.emailAccessService ?? null;
			let memory = input.dependencies.profileMemoryService ?? null;
			let profileMemoryPersistence: ReturnType<typeof createPgProfileMemoryPersistence> | null =
				null;
			let notices = input.dependencies.noticeService ?? null;
			let runtimeRuns = input.dependencies.runtimeRunService ?? null;
			let transportSchedule = input.dependencies.transportScheduleService ?? null;
			const resolveDiningLifecycleService = () =>
				(diningLifecycle ??= createPgDiningLifecycleService(input.env, { getDb: runtime.getDb }));
			const resolveProfileMemoryPersistence = () =>
				(profileMemoryPersistence ??= createPgProfileMemoryPersistence({
					getDb: runtime.getDb,
				}));
			const resolveProfileMemoryService = () => {
				const persistence = resolveProfileMemoryPersistence();
				if (!memory) {
					memory = buildProfileMemoryService({
						commandAdmitter: createExecutionControlPersonalMemoryClient(input.env),
						memoryReader: createExecutionControlPersonalMemoryClient(input.env),
						commandStore: persistence.commands,
						mutationStore: persistence.mutations,
						readStore: persistence.reads,
					});
				}
				return memory;
			};
			const resolveChatConversationService = () =>
				(chat ??= buildChatConversationService({
					detailStore: createPgChatConversationStore({ getDb: runtime.getDb }),
					store: createPgChatConversationStore({ getDb: runtime.getDb }),
				}));
			const resolveChatCommandService = () => {
				if (command) {
					return command;
				}
				if (!chatCommandPersistence) {
					chatCommandPersistence = createPgChatCommandPersistence({
						getDb: runtime.getDb,
					});
				}
				const persistence = chatCommandPersistence;
				command = buildChatCommandService({
					abuseThrottleEnabled: isAbuseThrottleEnabled(resolveEnvironment(input.env)),
					commandStore: persistence.commands,
					conversationStore: createPgChatConversationStore({
						getDb: runtime.getDb,
					}),
					...(executionRuntime ? { executionRuntime } : {}),
					isExecutionRuntimeConfigured: executionRuntimeConfigured,
					observabilityStore: persistence.observability,
					...(input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET
						? { safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET }
						: {}),
				});
				return command;
			};
			return {
				getDb: runtime.getDb,
				getAppAuth,
				resolveAccountAdminService: () =>
					(accountAdmin ??= buildAccountAdminService({
						authOrigin: new URL(readAppAuthConfig(input.env).authShellOrigin).origin,
						getAppAuth,
						store: createPgAccountAdminStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveAccountLifecycleService: () =>
					(accountLifecycle ??= buildAccountLifecycleService({
						diningLifecycleService: resolveDiningLifecycleService(),
						executionController: executionRuntime ?? createExecutionControlRuntimeClient(input.env),
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
						store: createPgAccountLifecycleStore({ getDb: runtime.getDb }),
					})),
				resolveCampusExperienceService: () => (campusExperience ??= buildCampusExperienceService()),
				resolveCampusGroupsService: () =>
					(campusGroups ??= buildCampusGroupsService(
						createPgCampusGroupsStore({ getDb: runtime.getDb }),
					)),
				resolveChatAvailabilityService: () =>
					(chatAvailability ??= buildChatAvailabilityService({
						store: createPgChatAvailabilityStore({ getDb: runtime.getDb }),
					})),
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDiningLifecycleService,
				resolveOpsConversationQueryService: () =>
					(opsConversationQuery ??= createOpsConversationQueryService({ getDb: runtime.getDb })),
				resolveChatFeedbackQueryService: () =>
					(feedbackQuery ??= createChatFeedbackQueryService({ getDb: runtime.getDb })),
				resolveDiningMapReadService: () =>
					(dining ??= createPgDiningMapReadService({
						getDb: runtime.getDb,
					})),
				resolveDiningContentService: () =>
					(diningContent ??= createPgDiningContentService({
						getDb: runtime.getDb,
					})),
				resolveDiningSubmissionService: () =>
					(diningSubmissions ??= createPgDiningSubmissionService(input.env, {
						getDb: runtime.getDb,
					})),
				resolveEmailAccessService: () =>
					(emailAccess ??= buildEmailAccessService({
						environment: resolveEnvironment(input.env),
						store: createPgEmailAccessGrantStore({ getDb: runtime.getDb }),
					})),
				resolveNoticeService: () =>
					(notices ??= buildNoticeService({
						objectStore: createNoticeObjectStore(input.env),
						store: createPgNoticeStore({ getDb: runtime.getDb }),
					})),
				resolveProfileMemoryService,
				resolveRuntimeRunService: () =>
					(runtimeRuns ??= (() => {
						const runtimeClient =
							executionRuntime ?? createExecutionControlRuntimeClient(input.env);
						return buildRuntimeRunService({
							executionRuntime: runtimeClient,
							ensureRun: ({ requestId }) => {
								if (!chatCommandPersistence) {
									chatCommandPersistence = createPgChatCommandPersistence({
										getDb: runtime.getDb,
									});
								}
								const persistence = chatCommandPersistence;
								return ensureDurableRunForStoredInput({
									commandStore: persistence.commands,
									executionRuntime: runtimeClient,
									requestId,
								});
							},
							store: createPgRuntimeRunStore({ getDb: runtime.getDb }),
						});
					})()),
				resolveTransportScheduleService: () =>
					(transportSchedule ??= createPgTransportScheduleService({
						getDb: runtime.getDb,
					})),
			};
		},
	};
}
