import type { Env } from "../config";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { AuthenticatedNoticeProcessingCommandService } from "../modules/authenticated-notice-processing-command";
import type { AuthenticatedNoticeProcessingQueryService } from "../modules/authenticated-notice-processing-query";
import type { AuthenticatedNoticeRunProcessingCommandService } from "../modules/authenticated-notice-run-processing-command";
import type { AuthenticatedNoticeRunProcessingQueryService } from "../modules/authenticated-notice-run-processing-query";
import type { ChatConversationService } from "../modules/chat";
import type { DocsService } from "../modules/docs";
import type { IdentityPlatformService } from "../modules/identity-platform";
import type { SupervisorCampusServicesProductPathPreflight } from "../modules/integration";
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
import type { ChatCommandService } from "../modules/runtime-command";
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
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	docsService?: DocsService;
	docsReadinessProbe?: () => Promise<AppDocsReadinessResult>;
	getAppAuth?: AppAuthGetter;
	getPrincipal?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	identityPlatformService?: IdentityPlatformService;
	officialWebCommandService?: OfficialWebCommandService;
	officialWebExecutionStatusService?: OfficialWebExecutionStatusService;
	officialWebPlannerService?: OfficialWebPlannerService;
	officialWebQueryService?: OfficialWebQueryService;
	officialWebReleaseTaskProcessingCommandService?: OfficialWebReleaseTaskProcessingCommandService;
	officialWebReleaseTaskProcessingQueryService?: OfficialWebReleaseTaskProcessingQueryService;
	officialWebTargetInventoryService?: OfficialWebTargetInventoryService;
	officialWebTargetJobService?: OfficialWebTargetJobService;
	officialWebTargetReleaseGateService?: OfficialWebTargetReleaseGateService;
	operatorObservabilityCommandService?: OperatorObservabilityCommandService;
	operatorQueryService?: OperatorQueryService;
	profileMemoryService?: ProfileMemoryService;
	wechatOfficialAccountCommandService?: WeChatOfficialAccountCommandService;
	scheduleRequestProjectionDrain?: (input: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
	telemetry?: AppTelemetry;
	runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
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

type AppRuntimeDependencyName = "auth" | "database" | "supervisorApi";

export interface AppRuntimeReadinessResult {
	dependencies: {
		auth: "ready" | "not_ready";
		authShellOrigin: "configured";
		database: "ready" | "not_ready";
		officialWebHandoff: "configured" | "not_configured";
		operatorBridge: "configured";
		publicChatCompatibilityOrigin: "configured";
		supervisorApi: "ready" | "not_ready";
	};
	failed: Partial<Record<AppRuntimeDependencyName, string>>;
	preflight?: {
		campusServicesProductPath?: SupervisorCampusServicesProductPathPreflight;
	};
}

export interface AppRequestScope {
	getAppAuth: AppAuthGetter;
	resolveAuthenticatedNoticeProcessingCommandService(): AuthenticatedNoticeProcessingCommandService;
	resolveAuthenticatedNoticeProcessingQueryService(): AuthenticatedNoticeProcessingQueryService;
	resolveAuthenticatedNoticeRunProcessingCommandService(): AuthenticatedNoticeRunProcessingCommandService;
	resolveAuthenticatedNoticeRunProcessingQueryService(): AuthenticatedNoticeRunProcessingQueryService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDocsService(): DocsService;
	resolveIdentityPlatformService(): IdentityPlatformService;
	resolveOfficialWebCommandService(): OfficialWebCommandService;
	resolveOfficialWebQueryService(): OfficialWebQueryService;
	resolveOfficialWebReleaseTaskProcessingCommandService(): OfficialWebReleaseTaskProcessingCommandService;
	resolveOfficialWebReleaseTaskProcessingQueryService(): OfficialWebReleaseTaskProcessingQueryService;
	resolveOfficialWebTargetInventoryService(): OfficialWebTargetInventoryService;
	resolveOfficialWebTargetJobService(): OfficialWebTargetJobService;
	resolveOfficialWebTargetReleaseGateService(): OfficialWebTargetReleaseGateService;
	resolveOperatorObservabilityCommandService(): OperatorObservabilityCommandService;
	resolveOperatorQueryService(): OperatorQueryService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveWeChatOfficialAccountCommandService(): WeChatOfficialAccountCommandService;
	telemetry: AppTelemetry;
}
