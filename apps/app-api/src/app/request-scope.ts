import type { Env } from "../config";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import { buildUnavailableDocsService } from "../modules/docs";
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
	createPgOperatorObservabilityCommandStore,
} from "../modules/operator-observability-command";
import { buildOperatorQueryService, createPgOperatorQueryStore } from "../modules/operator-query";
import { buildChatCommandService, createPgChatCommandStore } from "../modules/runtime-command";
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
			let chatConversationService = input.dependencies.chatConversationService ?? null;
			let chatCommandService = input.dependencies.chatCommandService ?? null;
			let docsService = input.dependencies.docsService ?? null;
			let officialWebCommandService = input.dependencies.officialWebCommandService ?? null;
			let officialWebQueryService = input.dependencies.officialWebQueryService ?? null;
			let operatorObservabilityCommandService =
				input.dependencies.operatorObservabilityCommandService ?? null;
			let operatorQueryService = input.dependencies.operatorQueryService ?? null;

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
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getFreshDb }),
					supervisor: createSupervisorExecutionClient(input.env),
					telemetry: input.telemetry,
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

				docsService = buildUnavailableDocsService();
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

			return {
				getAppAuth: input.dependencies.getAppAuth ?? runtime.getAppAuth,
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDocsService,
				resolveOfficialWebCommandService,
				resolveOfficialWebQueryService,
				resolveOperatorObservabilityCommandService,
				resolveOperatorQueryService,
			};
		},
		officialWebExecutionStatusService,
		officialWebPlannerService,
	};
}
