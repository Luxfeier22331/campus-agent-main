import type { Env } from "../config";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { AuthenticatedNoticeProcessingCommandService } from "../modules/authenticated-notice-processing-command";
import type { AuthenticatedNoticeProcessingQueryService } from "../modules/authenticated-notice-processing-query";
import type { AuthenticatedNoticeRunProcessingCommandService } from "../modules/authenticated-notice-run-processing-command";
import type { AuthenticatedNoticeRunProcessingQueryService } from "../modules/authenticated-notice-run-processing-query";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusServicesOpsService } from "../modules/campus-services-ops";
import type {
	CampusServicesTransportScheduleFetch,
	CampusServicesTransportScheduleService,
} from "../modules/campus-services-transport-schedule";
import type { ChatConversationService } from "../modules/chat";
import type { DiningOperationsService } from "../modules/dining-ops";
import type { DocsService } from "../modules/docs";
import type { IdentityPlatformService } from "../modules/identity-platform";
import type {
	ExecutionControlCampusServicesProductPathPreflight,
	ExecutionControlRuntimePreflight,
	IngestionTaskProjectionClient,
	IngestionTaskProjectionFetch,
} from "../modules/integration";
import type { ObservabilityConfigService } from "../modules/observability-config";
import type { OfficialWebCommandService } from "../modules/official-web-command";
import type { OfficialWebExecutionStatusService } from "../modules/official-web-execution";
import type { OfficialWebPlannerService } from "../modules/official-web-planner";
import type { OfficialWebQueryService } from "../modules/official-web-query";
import type { OfficialWebReleaseTaskProcessingCommandService } from "../modules/official-web-release-task-processing-command";
import type { OfficialWebReleaseTaskProcessingQueryService } from "../modules/official-web-release-task-processing-query";
import type { OfficialWebTargetInventoryService } from "../modules/official-web-target-inventory";
import type { OfficialWebTargetJobService } from "../modules/official-web-target-jobs";
import type { OfficialWebTargetReleaseGateService } from "../modules/official-web-target-release-gates";
import type { OperatorObservabilityCommandService } from "../modules/operator-observability-command";
import type { OperatorQueryService } from "../modules/operator-query";
import type { ProfileMemoryService } from "../modules/profile-memory";
import type { ProviderConfigService } from "../modules/provider-config";
import type { ChatCommandService } from "../modules/runtime-command";
import type { RuntimeRunService } from "../modules/runtime-run";
import type { AppTelemetry } from "../modules/telemetry";
import type { WeChatOfficialAccountCommandService } from "../modules/wechat-official-account-command";

export interface AppDependencies {
	authHandler?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<Response> | Response;
	authenticatedNoticeProcessingCommandService?: AuthenticatedNoticeProcessingCommandService;
	authenticatedNoticeProcessingQueryService?: AuthenticatedNoticeProcessingQueryService;
	authenticatedNoticeRunProcessingCommandService?: AuthenticatedNoticeRunProcessingCommandService;
	authenticatedNoticeRunProcessingQueryService?: AuthenticatedNoticeRunProcessingQueryService;
	campusExperienceService?: CampusExperienceService;
	campusServicesOpsService?: CampusServicesOpsService;
	campusServicesTransportScheduleFetch?: CampusServicesTransportScheduleFetch;
	campusServicesTransportScheduleService?: CampusServicesTransportScheduleService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningOperationsService?: DiningOperationsService;
	docsService?: DocsService;
	docsReadinessProbe?: () => Promise<AppDocsReadinessResult>;
	getAppAuth?: AppAuthGetter;
	getPrincipal?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	identityPlatformService?: IdentityPlatformService;
	ingestionTaskProjectionClient?: IngestionTaskProjectionClient;
	ingestionTaskProjectionFetch?: IngestionTaskProjectionFetch;
	officialWebCommandService?: OfficialWebCommandService;
	officialWebExecutionStatusService?: OfficialWebExecutionStatusService;
	officialWebPlannerService?: OfficialWebPlannerService;
	officialWebQueryService?: OfficialWebQueryService;
	officialWebReleaseTaskProcessingCommandService?: OfficialWebReleaseTaskProcessingCommandService;
	officialWebReleaseTaskProcessingQueryService?: OfficialWebReleaseTaskProcessingQueryService;
	officialWebTargetInventoryService?: OfficialWebTargetInventoryService;
	officialWebTargetJobService?: OfficialWebTargetJobService;
	officialWebTargetReleaseGateService?: OfficialWebTargetReleaseGateService;
	observabilityConfigService?: ObservabilityConfigService;
	operatorObservabilityCommandService?: OperatorObservabilityCommandService;
	operatorQueryService?: OperatorQueryService;
	profileMemoryService?: ProfileMemoryService;
	providerConfigService?: ProviderConfigService;
	wechatOfficialAccountCommandService?: WeChatOfficialAccountCommandService;
	scheduleRequestProjectionDrain?: (input: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
	telemetry?: AppTelemetry;
	runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
	runtimeRunService?: RuntimeRunService;
}

type AppDocsDependencyName = "auth" | "database" | "docsReadModel";

export interface AppDocsReadinessResult {
	dependencies: {
		auth: "ready" | "not_ready";
		database: "ready" | "not_ready";
		docsReadModel: "ready" | "not_ready";
	};
	failed: Partial<Record<AppDocsDependencyName, string>>;
}

type AppRuntimeDependencyName = "auth" | "database" | "executionRuntime" | "executionControl";

export interface AppRuntimeReadinessResult {
	dependencies: {
		auth: "ready" | "not_ready";
		authShellOrigin: "configured";
		database: "ready" | "not_ready";
		executionRuntime: "ready" | "not_ready" | "not_required";
		ingestionControl: "configured" | "misconfigured" | "not_configured";
		operatorSurface: "configured";
		executionControl: "ready" | "not_ready";
	};
	failed: Partial<Record<AppRuntimeDependencyName, string>>;
	preflight?: {
		campusServicesProductPath?: ExecutionControlCampusServicesProductPathPreflight;
		executionRuntime?: ExecutionControlRuntimePreflight;
	};
}

export interface AppRequestScope {
	getAppAuth: AppAuthGetter;
	resolveAuthenticatedNoticeProcessingCommandService(): AuthenticatedNoticeProcessingCommandService;
	resolveAuthenticatedNoticeProcessingQueryService(): AuthenticatedNoticeProcessingQueryService;
	resolveAuthenticatedNoticeRunProcessingCommandService(): AuthenticatedNoticeRunProcessingCommandService;
	resolveAuthenticatedNoticeRunProcessingQueryService(): AuthenticatedNoticeRunProcessingQueryService;
	resolveCampusExperienceService(): CampusExperienceService;
	resolveCampusServicesOpsService(): CampusServicesOpsService;
	resolveCampusServicesTransportScheduleService(): CampusServicesTransportScheduleService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningOperationsService(): DiningOperationsService;
	resolveDocsService(): DocsService;
	resolveIdentityPlatformService(): IdentityPlatformService;
	resolveIngestionTaskProjectionClient(): IngestionTaskProjectionClient;
	resolveOfficialWebCommandService(): OfficialWebCommandService;
	resolveOfficialWebQueryService(): OfficialWebQueryService;
	resolveOfficialWebReleaseTaskProcessingCommandService(): OfficialWebReleaseTaskProcessingCommandService;
	resolveOfficialWebReleaseTaskProcessingQueryService(): OfficialWebReleaseTaskProcessingQueryService;
	resolveOfficialWebTargetInventoryService(): OfficialWebTargetInventoryService;
	resolveOfficialWebTargetJobService(): OfficialWebTargetJobService;
	resolveOfficialWebTargetReleaseGateService(): OfficialWebTargetReleaseGateService;
	resolveObservabilityConfigService(): ObservabilityConfigService;
	resolveOperatorObservabilityCommandService(): OperatorObservabilityCommandService;
	resolveOperatorQueryService(): OperatorQueryService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveProviderConfigService(): ProviderConfigService;
	resolveRuntimeRunService(): RuntimeRunService;
	resolveWeChatOfficialAccountCommandService(): WeChatOfficialAccountCommandService;
	telemetry: AppTelemetry;
}
