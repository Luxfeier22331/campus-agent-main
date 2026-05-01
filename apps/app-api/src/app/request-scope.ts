import type { Env } from "../config";
import {
	buildAuthenticatedNoticeProcessingCommandService,
	createPgAuthenticatedNoticeProcessingCommandStore,
} from "../modules/authenticated-notice-processing-command";
import {
	buildAuthenticatedNoticeProcessingQueryService,
	createPgAuthenticatedNoticeProcessingQueryStore,
} from "../modules/authenticated-notice-processing-query";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import { buildDocsService, createPgDocsReadModelStore } from "../modules/docs";
import { createSupervisorExecutionClient } from "../modules/integration";
import {
	buildOfficialWebCommandService,
	createPgOfficialWebCommandStore,
} from "../modules/official-web-command";
import { buildOfficialWebExecutionStatusService } from "../modules/official-web-execution";
import {
	buildOfficialWebPlannerService,
	createPgOfficialWebPlannerStore,
} from "../modules/official-web-planner";
import { createPgOfficialWebProjectionStore } from "../modules/official-web-projection";
import {
	buildOfficialWebQueryService,
	createPgOfficialWebQueryStore,
} from "../modules/official-web-query";
import {
	buildOperatorObservabilityCommandService,
	buildOperatorTraceBacklinkRecorder,
	createPgOperatorObservabilityCommandStore,
} from "../modules/operator-observability-command";
import { buildOperatorQueryService, createPgOperatorQueryStore } from "../modules/operator-query";
import { buildProfileMemoryService, createPgProfileMemoryStore } from "../modules/profile-memory";
import { buildChatCommandService, createPgChatCommandStore } from "../modules/runtime-command";
import {
	buildWeChatOfficialAccountCommandService,
	createPgWeChatOfficialAccountCommandStore,
} from "../modules/wechat-official-account-command";
import { createRequestRuntimeScope } from "../request-runtime-scope";
import type { AppDependencies, AppRequestScope } from "./types";

export function createRequestScopeFactory(input: {
	dependencies: AppDependencies;
	env: Env;
	telemetry: import("../modules/telemetry").AppTelemetry;
}) {
	const officialWebExecutionStatusService =
		input.dependencies.officialWebExecutionStatusService ??
		buildOfficialWebExecutionStatusService({
			store: createPgOfficialWebProjectionStore(input.env),
		});
	const officialWebPlannerService =
		input.dependencies.officialWebPlannerService ??
		buildOfficialWebPlannerService({
			store: createPgOfficialWebPlannerStore(input.env),
		});

	return {
		createRequestScope(): AppRequestScope {
			const runtime = createRequestRuntimeScope(input.env);
			let authenticatedNoticeProcessingCommandService =
				input.dependencies.authenticatedNoticeProcessingCommandService ?? null;
			let authenticatedNoticeProcessingQueryService =
				input.dependencies.authenticatedNoticeProcessingQueryService ?? null;
			let chatConversationService = input.dependencies.chatConversationService ?? null;
			let chatCommandService = input.dependencies.chatCommandService ?? null;
			let docsService = input.dependencies.docsService ?? null;
			let officialWebCommandService = input.dependencies.officialWebCommandService ?? null;
			let officialWebQueryService = input.dependencies.officialWebQueryService ?? null;
			let operatorObservabilityCommandService =
				input.dependencies.operatorObservabilityCommandService ?? null;
			let operatorQueryService = input.dependencies.operatorQueryService ?? null;
			let profileMemoryService = input.dependencies.profileMemoryService ?? null;
			let weChatOfficialAccountCommandService =
				input.dependencies.wechatOfficialAccountCommandService ?? null;

			function resolveAuthenticatedNoticeProcessingCommandService() {
				if (authenticatedNoticeProcessingCommandService) {
					return authenticatedNoticeProcessingCommandService;
				}

				authenticatedNoticeProcessingCommandService =
					buildAuthenticatedNoticeProcessingCommandService({
						store: createPgAuthenticatedNoticeProcessingCommandStore(input.env, {
							getDb: runtime.getFreshDb,
						}),
					});
				return authenticatedNoticeProcessingCommandService;
			}

			function resolveAuthenticatedNoticeProcessingQueryService() {
				if (authenticatedNoticeProcessingQueryService) {
					return authenticatedNoticeProcessingQueryService;
				}

				authenticatedNoticeProcessingQueryService = buildAuthenticatedNoticeProcessingQueryService({
					store: createPgAuthenticatedNoticeProcessingQueryStore(input.env, {
						getDb: runtime.getDb,
					}),
				});
				return authenticatedNoticeProcessingQueryService;
			}

			function resolveChatConversationService() {
				if (chatConversationService) {
					return chatConversationService;
				}

				chatConversationService = buildChatConversationService({
					store: createPgChatConversationStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return chatConversationService;
			}

			function resolveChatCommandService() {
				if (chatCommandService) {
					return chatCommandService;
				}

				const chatConversationStore = createPgChatConversationStore(input.env, {
					getDb: runtime.getFreshDb,
				});
				chatCommandService = buildChatCommandService({
					conversationStore: chatConversationStore,
					profileMemoryStore: createPgProfileMemoryStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getFreshDb }),
					supervisor: createSupervisorExecutionClient(input.env),
					telemetry: input.telemetry,
					traceBacklinkRecorder: buildOperatorTraceBacklinkRecorder({
						env: input.env,
						resolveCommandService: resolveOperatorObservabilityCommandService,
					}),
				});
				return chatCommandService;
			}

			function resolveOfficialWebCommandService() {
				if (officialWebCommandService) {
					return officialWebCommandService;
				}

				officialWebCommandService = buildOfficialWebCommandService({
					store: createPgOfficialWebCommandStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return officialWebCommandService;
			}

			function resolveDocsService() {
				if (docsService) {
					return docsService;
				}

				docsService = buildDocsService({
					store: createPgDocsReadModelStore(input.env, { getDb: runtime.getDb }),
				});
				return docsService;
			}

			function resolveOfficialWebQueryService() {
				if (officialWebQueryService) {
					return officialWebQueryService;
				}

				officialWebQueryService = buildOfficialWebQueryService({
					store: createPgOfficialWebQueryStore(input.env, { getDb: runtime.getDb }),
				});
				return officialWebQueryService;
			}

			function resolveOperatorQueryService() {
				if (operatorQueryService) {
					return operatorQueryService;
				}

				operatorQueryService = buildOperatorQueryService({
					store: createPgOperatorQueryStore(input.env, { getDb: runtime.getDb }),
				});
				return operatorQueryService;
			}

			function resolveOperatorObservabilityCommandService() {
				if (operatorObservabilityCommandService) {
					return operatorObservabilityCommandService;
				}

				operatorObservabilityCommandService = buildOperatorObservabilityCommandService({
					store: createPgOperatorObservabilityCommandStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
					telemetry: input.telemetry,
				});
				return operatorObservabilityCommandService;
			}

			function resolveProfileMemoryService() {
				if (profileMemoryService) {
					return profileMemoryService;
				}

				profileMemoryService = buildProfileMemoryService({
					store: createPgProfileMemoryStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return profileMemoryService;
			}

			function resolveWeChatOfficialAccountCommandService() {
				if (weChatOfficialAccountCommandService) {
					return weChatOfficialAccountCommandService;
				}

				weChatOfficialAccountCommandService = buildWeChatOfficialAccountCommandService({
					store: createPgWeChatOfficialAccountCommandStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
				});
				return weChatOfficialAccountCommandService;
			}

			return {
				getAppAuth: input.dependencies.getAppAuth ?? runtime.getAppAuth,
				resolveAuthenticatedNoticeProcessingCommandService,
				resolveAuthenticatedNoticeProcessingQueryService,
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDocsService,
				resolveOfficialWebCommandService,
				resolveOfficialWebQueryService,
				resolveOperatorObservabilityCommandService,
				resolveOperatorQueryService,
				resolveProfileMemoryService,
				resolveWeChatOfficialAccountCommandService,
			};
		},
		officialWebExecutionStatusService,
		officialWebPlannerService,
	};
}
