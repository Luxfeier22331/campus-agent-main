import {
	type Env,
	isDeployedEnvironment,
	readPublicNoticeURLAllowlist,
	resolveEnvironment,
} from "../config";
import { buildCampusExperienceService } from "../modules/campus-experience";
import {
	buildCampusServicesOpsService,
	createPgCampusServicesOpsStore,
} from "../modules/campus-services-ops";
import {
	buildCampusServicesTransportScheduleService,
	createPgCampusServicesTransportScheduleStore,
} from "../modules/campus-services-transport-schedule";
import { buildChatConversationService, createPgChatConversationStore } from "../modules/chat";
import { buildDiningOperationsService, createPgDiningOperationsStore } from "../modules/dining-ops";
import { buildDocsService, createPgDocsReadModelStore } from "../modules/docs";
import {
	buildIdentityPlatformService,
	createPgIdentityPlatformStore,
} from "../modules/identity-platform";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlProviderConfigClient,
	createExecutionControlRuntimeClient,
	createIngestionTaskProjectionClient,
	isExecutionControlRuntimeConfigured,
} from "../modules/integration";
import { buildProfileMemoryService, createPgProfileMemoryStore } from "../modules/profile-memory";
import {
	buildProviderConfigService,
	createPgProviderConfigStore,
} from "../modules/provider-config";
import { buildChatCommandService, createPgChatCommandStore } from "../modules/runtime-command";
import { buildRuntimeRunService, createPgRuntimeRunStore } from "../modules/runtime-run";
import { createRequestRuntimeScope } from "../request-runtime-scope";
import type { AppDependencies, AppRequestScope } from "./types";

export function createRequestScopeFactory(input: {
	dependencies: AppDependencies;
	env: Env;
	telemetry: import("../modules/telemetry").AppTelemetry;
}) {
	const environment = resolveEnvironment(input.env);
	const requireExecutionRuntime = isDeployedEnvironment(environment);
	const executionRuntimeConfigured = isExecutionControlRuntimeConfigured(input.env);
	const executionRuntime = executionRuntimeConfigured
		? createExecutionControlRuntimeClient(input.env)
		: undefined;
	return {
		createRequestScope(): AppRequestScope {
			const runtime = createRequestRuntimeScope(input.env);
			let campusExperienceService = input.dependencies.campusExperienceService ?? null;
			let campusServicesOpsService = input.dependencies.campusServicesOpsService ?? null;
			let campusServicesTransportScheduleService =
				input.dependencies.campusServicesTransportScheduleService ?? null;
			let chatConversationService = input.dependencies.chatConversationService ?? null;
			let chatCommandService = input.dependencies.chatCommandService ?? null;
			let diningOperationsService = input.dependencies.diningOperationsService ?? null;
			let docsService = input.dependencies.docsService ?? null;
			let identityPlatformService = input.dependencies.identityPlatformService ?? null;
			let ingestionTaskProjectionClient = input.dependencies.ingestionTaskProjectionClient ?? null;
			let profileMemoryService = input.dependencies.profileMemoryService ?? null;
			let providerConfigService = input.dependencies.providerConfigService ?? null;
			let runtimeRunService = input.dependencies.runtimeRunService ?? null;

			function resolveChatConversationService() {
				if (chatConversationService) {
					return chatConversationService;
				}

				chatConversationService = buildChatConversationService({
					detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getFreshDb }),
					store: createPgChatConversationStore(input.env, { getDb: runtime.getDb }),
				});
				return chatConversationService;
			}

			function resolveCampusServicesOpsService() {
				if (campusServicesOpsService) {
					return campusServicesOpsService;
				}

				campusServicesOpsService = buildCampusServicesOpsService({
					store: createPgCampusServicesOpsStore(input.env, { getDb: runtime.getDb }),
				});
				return campusServicesOpsService;
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
					publicNoticeURLAllowlist: readPublicNoticeURLAllowlist(input.env),
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getDb }),
					executionRuntime,
					isExecutionRuntimeConfigured: executionRuntimeConfigured,
					profileMemoryStore: createPgProfileMemoryStore(input.env, {
						getDb: runtime.getDb,
					}),
					requireExecutionRuntime,
					telemetry: input.telemetry,
				});
				return chatCommandService;
			}

			function resolveCampusExperienceService() {
				if (campusExperienceService) {
					return campusExperienceService;
				}

				campusExperienceService = buildCampusExperienceService();
				return campusExperienceService;
			}

			function resolveCampusServicesTransportScheduleService() {
				if (campusServicesTransportScheduleService) {
					return campusServicesTransportScheduleService;
				}

				campusServicesTransportScheduleService = buildCampusServicesTransportScheduleService({
					store: createPgCampusServicesTransportScheduleStore(input.env, {
						getDb: runtime.getDb,
					}),
				});
				return campusServicesTransportScheduleService;
			}

			function resolveDiningOperationsService() {
				if (diningOperationsService) {
					return diningOperationsService;
				}

				diningOperationsService = buildDiningOperationsService({
					store: createPgDiningOperationsStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return diningOperationsService;
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

			function resolveIdentityPlatformService() {
				if (identityPlatformService) {
					return identityPlatformService;
				}

				identityPlatformService = buildIdentityPlatformService({
					identityStore: createPgIdentityPlatformStore(input.env, {
						getDb: runtime.getDb,
					}),
					profileMemoryStore: createPgProfileMemoryStore(input.env, {
						getDb: runtime.getDb,
					}),
				});
				return identityPlatformService;
			}

			function resolveIngestionTaskProjectionClient() {
				if (ingestionTaskProjectionClient) {
					return ingestionTaskProjectionClient;
				}

				ingestionTaskProjectionClient = createIngestionTaskProjectionClient(input.env, {
					fetchImplementation: input.dependencies.ingestionTaskProjectionFetch,
				});
				return ingestionTaskProjectionClient;
			}

			function resolveProfileMemoryService() {
				if (profileMemoryService) {
					return profileMemoryService;
				}

				profileMemoryService = buildProfileMemoryService({
					memoryIndexer: createExecutionControlPersonalMemoryClient(input.env),
					store: createPgProfileMemoryStore(input.env, { getDb: runtime.getDb }),
				});
				return profileMemoryService;
			}

			function resolveProviderConfigService() {
				if (providerConfigService) {
					return providerConfigService;
				}

				providerConfigService = buildProviderConfigService({
					encryptionKey: input.env.APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY,
					store: createPgProviderConfigStore(input.env, { getDb: runtime.getFreshDb }),
					validators: {
						checkEmbeddingCompatibility: async (compatibilityInput) =>
							createExecutionControlProviderConfigClient(input.env).checkEmbeddingCompatibility({
								baseUrl: compatibilityInput.baseUrl,
								dimensions: compatibilityInput.dimensions ?? 0,
								model: compatibilityInput.model,
								provider: compatibilityInput.provider,
								role: compatibilityInput.role,
								timeoutMs: compatibilityInput.timeoutMs,
								transport: compatibilityInput.transport,
							}),
					},
				});
				return providerConfigService;
			}

			function resolveRuntimeRunService() {
				if (runtimeRunService) {
					return runtimeRunService;
				}

				runtimeRunService = buildRuntimeRunService({
					executionRuntime: createExecutionControlRuntimeClient(input.env),
					store: createPgRuntimeRunStore(input.env, { getDb: runtime.getDb }),
				});
				return runtimeRunService;
			}

			return {
				getAppAuth: input.dependencies.getAppAuth ?? runtime.getAppAuth,
				resolveCampusExperienceService,
				resolveCampusServicesOpsService,
				resolveCampusServicesTransportScheduleService,
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDiningOperationsService,
				resolveDocsService,
				resolveIdentityPlatformService,
				resolveIngestionTaskProjectionClient,
				resolveProfileMemoryService,
				resolveProviderConfigService,
				resolveRuntimeRunService,
				telemetry: input.telemetry,
			};
		},
	};
}
