import { type Env, isDeployedEnvironment, resolveEnvironment } from "../config";
import {
	buildAuthenticatedNoticeProcessingCommandService,
	createPgAuthenticatedNoticeProcessingCommandStore,
} from "../modules/authenticated-notice-processing-command";
import {
	buildAuthenticatedNoticeProcessingQueryService,
	createPgAuthenticatedNoticeProcessingQueryStore,
} from "../modules/authenticated-notice-processing-query";
import {
	buildAuthenticatedNoticeRunProcessingCommandService,
	createPgAuthenticatedNoticeRunProcessingCommandStore,
} from "../modules/authenticated-notice-run-processing-command";
import {
	buildAuthenticatedNoticeRunProcessingQueryService,
	createPgAuthenticatedNoticeRunProcessingQueryStore,
} from "../modules/authenticated-notice-run-processing-query";
import { buildCampusExperienceService } from "../modules/campus-experience";
import {
	buildCampusServicesOpsService,
	createPgCampusServicesOpsStore,
} from "../modules/campus-services-ops";
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
	probeExecutionControlOperatorRuntimeHealth,
} from "../modules/integration";
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
	buildOfficialWebReleaseTaskProcessingCommandService,
	createPgOfficialWebReleaseTaskProcessingCommandStore,
} from "../modules/official-web-release-task-processing-command";
import {
	buildOfficialWebReleaseTaskProcessingQueryService,
	createPgOfficialWebReleaseTaskProcessingQueryStore,
} from "../modules/official-web-release-task-processing-query";
import {
	buildOfficialWebTargetInventoryService,
	createPgOfficialWebTargetInventoryFieldStatusStore,
	createPgOfficialWebTargetInventoryPreviewEvidenceStore,
} from "../modules/official-web-target-inventory";
import {
	buildOfficialWebTargetJobService,
	createPgOfficialWebTargetJobStore,
} from "../modules/official-web-target-jobs";
import {
	buildOfficialWebTargetReleaseGateService,
	createPgOfficialWebTargetReleaseGateStore,
} from "../modules/official-web-target-release-gates";
import {
	buildOperatorObservabilityCommandService,
	buildOperatorTraceBacklinkRecorder,
	createPgOperatorObservabilityCommandStore,
} from "../modules/operator-observability-command";
import { buildOperatorQueryService, createPgOperatorQueryStore } from "../modules/operator-query";
import { buildProfileMemoryService, createPgProfileMemoryStore } from "../modules/profile-memory";
import {
	buildProviderConfigService,
	createPgProviderConfigStore,
} from "../modules/provider-config";
import { buildChatCommandService, createPgChatCommandStore } from "../modules/runtime-command";
import { buildRuntimeRunService, createPgRuntimeRunStore } from "../modules/runtime-run";
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
	const environment = resolveEnvironment(input.env);
	const requireExecutionRuntime = isDeployedEnvironment(environment);
	const executionRuntimeConfigured = isExecutionControlRuntimeConfigured(input.env);
	const executionRuntime = executionRuntimeConfigured
		? createExecutionControlRuntimeClient(input.env)
		: undefined;
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
			let authenticatedNoticeRunProcessingCommandService =
				input.dependencies.authenticatedNoticeRunProcessingCommandService ?? null;
			let authenticatedNoticeRunProcessingQueryService =
				input.dependencies.authenticatedNoticeRunProcessingQueryService ?? null;
			let campusExperienceService = input.dependencies.campusExperienceService ?? null;
			let campusServicesOpsService = input.dependencies.campusServicesOpsService ?? null;
			let chatConversationService = input.dependencies.chatConversationService ?? null;
			let chatCommandService = input.dependencies.chatCommandService ?? null;
			let diningOperationsService = input.dependencies.diningOperationsService ?? null;
			let docsService = input.dependencies.docsService ?? null;
			let identityPlatformService = input.dependencies.identityPlatformService ?? null;
			let ingestionTaskProjectionClient = input.dependencies.ingestionTaskProjectionClient ?? null;
			let officialWebCommandService = input.dependencies.officialWebCommandService ?? null;
			let officialWebQueryService = input.dependencies.officialWebQueryService ?? null;
			let officialWebReleaseTaskProcessingCommandService =
				input.dependencies.officialWebReleaseTaskProcessingCommandService ?? null;
			let officialWebReleaseTaskProcessingQueryService =
				input.dependencies.officialWebReleaseTaskProcessingQueryService ?? null;
			let officialWebTargetInventoryService =
				input.dependencies.officialWebTargetInventoryService ?? null;
			let officialWebTargetJobService = input.dependencies.officialWebTargetJobService ?? null;
			let officialWebTargetReleaseGateService =
				input.dependencies.officialWebTargetReleaseGateService ?? null;
			let operatorObservabilityCommandService =
				input.dependencies.operatorObservabilityCommandService ?? null;
			let operatorQueryService = input.dependencies.operatorQueryService ?? null;
			let profileMemoryService = input.dependencies.profileMemoryService ?? null;
			let providerConfigService = input.dependencies.providerConfigService ?? null;
			let runtimeRunService = input.dependencies.runtimeRunService ?? null;
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

			function resolveAuthenticatedNoticeRunProcessingCommandService() {
				if (authenticatedNoticeRunProcessingCommandService) {
					return authenticatedNoticeRunProcessingCommandService;
				}

				authenticatedNoticeRunProcessingCommandService =
					buildAuthenticatedNoticeRunProcessingCommandService({
						store: createPgAuthenticatedNoticeRunProcessingCommandStore(input.env, {
							getDb: runtime.getFreshDb,
						}),
					});
				return authenticatedNoticeRunProcessingCommandService;
			}

			function resolveAuthenticatedNoticeRunProcessingQueryService() {
				if (authenticatedNoticeRunProcessingQueryService) {
					return authenticatedNoticeRunProcessingQueryService;
				}

				authenticatedNoticeRunProcessingQueryService =
					buildAuthenticatedNoticeRunProcessingQueryService({
						store: createPgAuthenticatedNoticeRunProcessingQueryStore(input.env, {
							getDb: runtime.getDb,
						}),
					});
				return authenticatedNoticeRunProcessingQueryService;
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

			function resolveCampusServicesOpsService() {
				if (campusServicesOpsService) {
					return campusServicesOpsService;
				}

				campusServicesOpsService = buildCampusServicesOpsService({
					store: createPgCampusServicesOpsStore(input.env, { getDb: runtime.getFreshDb }),
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
					safetyIdentifierHmacSecret: input.env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET,
					store: createPgChatCommandStore(input.env, { getDb: runtime.getFreshDb }),
					executionRuntime,
					isExecutionRuntimeConfigured: executionRuntimeConfigured,
					profileMemoryStore: createPgProfileMemoryStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
					requireExecutionRuntime,
					telemetry: input.telemetry,
					traceBacklinkRecorder: buildOperatorTraceBacklinkRecorder({
						env: input.env,
						resolveCommandService: resolveOperatorObservabilityCommandService,
					}),
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

			function resolveDiningOperationsService() {
				if (diningOperationsService) {
					return diningOperationsService;
				}

				diningOperationsService = buildDiningOperationsService({
					store: createPgDiningOperationsStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return diningOperationsService;
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

			function resolveOfficialWebTargetJobService() {
				if (officialWebTargetJobService) {
					return officialWebTargetJobService;
				}

				officialWebTargetJobService = buildOfficialWebTargetJobService({
					store: createPgOfficialWebTargetJobStore(input.env, { getDb: runtime.getDb }),
				});
				return officialWebTargetJobService;
			}

			function resolveOfficialWebTargetInventoryService() {
				if (officialWebTargetInventoryService) {
					return officialWebTargetInventoryService;
				}

				officialWebTargetInventoryService = buildOfficialWebTargetInventoryService({
					fieldStatusStore: createPgOfficialWebTargetInventoryFieldStatusStore(input.env, {
						getDb: runtime.getDb,
					}),
					previewEvidenceStore: createPgOfficialWebTargetInventoryPreviewEvidenceStore(input.env, {
						getDb: runtime.getDb,
					}),
				});
				return officialWebTargetInventoryService;
			}

			function resolveOfficialWebTargetReleaseGateService() {
				if (officialWebTargetReleaseGateService) {
					return officialWebTargetReleaseGateService;
				}

				officialWebTargetReleaseGateService = buildOfficialWebTargetReleaseGateService({
					inventoryService: resolveOfficialWebTargetInventoryService(),
					store: createPgOfficialWebTargetReleaseGateStore(input.env, {
						getDb: runtime.getFreshDb,
					}),
				});
				return officialWebTargetReleaseGateService;
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
						getDb: runtime.getFreshDb,
					}),
					profileMemoryStore: createPgProfileMemoryStore(input.env, {
						getDb: runtime.getFreshDb,
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

			function resolveOfficialWebQueryService() {
				if (officialWebQueryService) {
					return officialWebQueryService;
				}

				officialWebQueryService = buildOfficialWebQueryService({
					store: createPgOfficialWebQueryStore(input.env, { getDb: runtime.getDb }),
				});
				return officialWebQueryService;
			}

			function resolveOfficialWebReleaseTaskProcessingCommandService() {
				if (officialWebReleaseTaskProcessingCommandService) {
					return officialWebReleaseTaskProcessingCommandService;
				}

				officialWebReleaseTaskProcessingCommandService =
					buildOfficialWebReleaseTaskProcessingCommandService({
						store: createPgOfficialWebReleaseTaskProcessingCommandStore(input.env, {
							getDb: runtime.getFreshDb,
						}),
					});
				return officialWebReleaseTaskProcessingCommandService;
			}

			function resolveOfficialWebReleaseTaskProcessingQueryService() {
				if (officialWebReleaseTaskProcessingQueryService) {
					return officialWebReleaseTaskProcessingQueryService;
				}

				officialWebReleaseTaskProcessingQueryService =
					buildOfficialWebReleaseTaskProcessingQueryService({
						store: createPgOfficialWebReleaseTaskProcessingQueryStore(input.env, {
							getDb: runtime.getDb,
						}),
					});
				return officialWebReleaseTaskProcessingQueryService;
			}

			function resolveOperatorQueryService() {
				if (operatorQueryService) {
					return operatorQueryService;
				}

				operatorQueryService = buildOperatorQueryService({
					executionRuntime: createExecutionControlRuntimeClient(input.env),
					runtimeHealthProbe: () => probeExecutionControlOperatorRuntimeHealth(input.env),
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
					memoryIndexer: createExecutionControlPersonalMemoryClient(input.env),
					store: createPgProfileMemoryStore(input.env, { getDb: runtime.getFreshDb }),
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
						checkEmbeddingCompatibility: async ({ profile }) =>
							createExecutionControlProviderConfigClient(input.env).checkEmbeddingCompatibility({
								baseUrl: profile.baseUrl,
								dimensions: profile.dimensions ?? 0,
								model: profile.model,
								provider: profile.provider,
								role: profile.role,
								timeoutMs: profile.timeoutMs,
								transport: profile.transport,
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
					store: createPgRuntimeRunStore(input.env, { getDb: runtime.getFreshDb }),
				});
				return runtimeRunService;
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
				resolveAuthenticatedNoticeRunProcessingCommandService,
				resolveAuthenticatedNoticeRunProcessingQueryService,
				resolveCampusExperienceService,
				resolveCampusServicesOpsService,
				resolveChatCommandService,
				resolveChatConversationService,
				resolveDiningOperationsService,
				resolveDocsService,
				resolveIdentityPlatformService,
				resolveIngestionTaskProjectionClient,
				resolveOfficialWebCommandService,
				resolveOfficialWebQueryService,
				resolveOfficialWebReleaseTaskProcessingCommandService,
				resolveOfficialWebReleaseTaskProcessingQueryService,
				resolveOfficialWebTargetInventoryService,
				resolveOfficialWebTargetJobService,
				resolveOfficialWebTargetReleaseGateService,
				resolveOperatorObservabilityCommandService,
				resolveOperatorQueryService,
				resolveProfileMemoryService,
				resolveProviderConfigService,
				resolveRuntimeRunService,
				resolveWeChatOfficialAccountCommandService,
				telemetry: input.telemetry,
			};
		},
		officialWebExecutionStatusService,
		officialWebPlannerService,
	};
}
