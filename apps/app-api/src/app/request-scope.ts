import {
	type Env,
	isDeployedEnvironment,
	readPublicNoticeURLAllowlist,
	resolveEnvironment,
} from "../config";
import { buildCampusExperienceService } from "../modules/campus-experience";
import { buildCampusGroupsService, createPgCampusGroupsStore } from "../modules/campus-groups";
import {
	buildCampusServicesTransportScheduleService,
	createPgCampusServicesTransportScheduleStore,
} from "../modules/campus-services-transport-schedule";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import { createPgDiningContentService, createPgDiningMapReadService } from "../modules/dining";
import { buildDocsService, createPgDocsReadModelStore } from "../modules/docs";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "../modules/integration";
import { buildProfileMemoryService, createPgProfileMemoryStore } from "../modules/profile-memory";
import { buildChatCommandService, createPgChatCommandStore } from "../modules/runtime-command";
import { buildRuntimeRunService, createPgRuntimeRunStore } from "../modules/runtime-run";
import { createRequestRuntimeScope } from "../request-runtime-scope";
import type { AppDependencies, AppRequestScope } from "./types";

export function createRequestScopeFactory(input: {
	dependencies: AppDependencies;
	env: Env;
	telemetry: import("../modules/telemetry").AppTelemetry;
}) {
	const requireExecutionRuntime = isDeployedEnvironment(resolveEnvironment(input.env));
	const executionRuntimeConfigured = isExecutionControlRuntimeConfigured(input.env);
	const executionRuntime = executionRuntimeConfigured
		? createExecutionControlRuntimeClient(input.env)
		: undefined;
	return {
		createRequestScope(): AppRequestScope {
			const runtime = createRequestRuntimeScope(input.env);
			let campusExperience = input.dependencies.campusExperienceService ?? null;
			let campusGroups = input.dependencies.campusGroupsService ?? null;
			let campusServices = input.dependencies.campusServicesTransportScheduleService ?? null;
			let chat = input.dependencies.chatConversationService ?? null;
			let command = input.dependencies.chatCommandService ?? null;
			let dining = input.dependencies.diningMapReadService ?? null;
			let diningContent = input.dependencies.diningContentService ?? null;
			let docs = input.dependencies.docsService ?? null;
			let memory = input.dependencies.profileMemoryService ?? null;
			let runtimeRuns = input.dependencies.runtimeRunService ?? null;
			const resolveProfileMemoryService = () =>
				(memory ??= buildProfileMemoryService({
					commandAdmitter: createExecutionControlPersonalMemoryClient(input.env),
					store: createPgProfileMemoryStore(input.env, { getDb: runtime.getFreshDb }),
				}));
			const resolveChatConversationService = () =>
				(chat ??= buildChatConversationService({
					detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getFreshDb }),
					dispatchMemoryCommands: () => resolveProfileMemoryService().dispatchPending(),
					store: createPgChatConversationStore(input.env, { getDb: runtime.getDb }),
				}));
			const resolveChatCommandService = () =>
				(command ??= buildChatCommandService({
					conversationStore: createPgChatConversationStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
					executionRuntime,
					isExecutionRuntimeConfigured: executionRuntimeConfigured,
					profileMemoryStore: createPgProfileMemoryStore(input.env, { getDb: runtime.getDb }),
					publicNoticeURLAllowlist: readPublicNoticeURLAllowlist(input.env),
					requireExecutionRuntime,
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getDb }),
					telemetry: input.telemetry,
				}));
			return {
				getAppAuth: input.dependencies.getAppAuth ?? runtime.getAppAuth,
				resolveCampusExperienceService: () => (campusExperience ??= buildCampusExperienceService()),
				resolveCampusGroupsService: () =>
					(campusGroups ??= buildCampusGroupsService(
						createPgCampusGroupsStore(input.env, { getDb: runtime.getFreshDb }),
					)),
				resolveCampusServicesTransportScheduleService: () =>
					(campusServices ??= buildCampusServicesTransportScheduleService({
						store: createPgCampusServicesTransportScheduleStore(input.env, {
							getDb: runtime.getDb,
						}),
					})),
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDiningMapReadService: () =>
					(dining ??= createPgDiningMapReadService(input.env, {
						getDb: runtime.getFreshDb,
					})),
				resolveDiningContentService: () =>
					(diningContent ??= createPgDiningContentService(input.env, {
						getDb: runtime.getFreshDb,
					})),
				resolveDocsService: () =>
					(docs ??= buildDocsService({
						store: createPgDocsReadModelStore(input.env, { getDb: runtime.getDb }),
					})),
				resolveProfileMemoryService,
				resolveRuntimeRunService: () =>
					(runtimeRuns ??= buildRuntimeRunService({
						executionRuntime: createExecutionControlRuntimeClient(input.env),
						store: createPgRuntimeRunStore(input.env, { getDb: runtime.getDb }),
					})),
				telemetry: input.telemetry,
			};
		},
	};
}
