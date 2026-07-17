import type { Env } from "../config";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusServicesOpsService } from "../modules/campus-services-ops";
import type { CampusServicesTransportScheduleService } from "../modules/campus-services-transport-schedule";
import type { ChatConversationService } from "../modules/chat";
import type { DiningPublicReadService } from "../modules/dining";
import type { DocsService } from "../modules/docs";
import type { IdentityPlatformService } from "../modules/identity-platform";
import type {
	ExecutionControlCampusServicesProductPathPreflight,
	ExecutionControlRuntimePreflight,
	IngestionTaskProjectionClient,
	IngestionTaskProjectionFetch,
} from "../modules/integration";
import type { ProfileMemoryService } from "../modules/profile-memory";
import type { ChatCommandService } from "../modules/runtime-command";
import type { RuntimeRunService } from "../modules/runtime-run";
import type { AppTelemetry } from "../modules/telemetry";

export interface AppDependencies {
	authHandler?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<Response> | Response;
	campusExperienceService?: CampusExperienceService;
	campusServicesOpsService?: CampusServicesOpsService;
	campusServicesTransportScheduleService?: CampusServicesTransportScheduleService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningPublicReadService?: DiningPublicReadService;
	docsService?: DocsService;
	docsReadinessProbe?: (releaseId: string) => Promise<AppDocsReadinessResult>;
	getAppAuth?: AppAuthGetter;
	getPrincipal?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	identityPlatformService?: IdentityPlatformService;
	ingestionTaskProjectionClient?: IngestionTaskProjectionClient;
	ingestionTaskProjectionFetch?: IngestionTaskProjectionFetch;
	profileMemoryService?: ProfileMemoryService;
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
	resolveCampusExperienceService(): CampusExperienceService;
	resolveCampusServicesOpsService(): CampusServicesOpsService;
	resolveCampusServicesTransportScheduleService(): CampusServicesTransportScheduleService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningPublicReadService(): DiningPublicReadService;
	resolveDocsService(): DocsService;
	resolveIdentityPlatformService(): IdentityPlatformService;
	resolveIngestionTaskProjectionClient(): IngestionTaskProjectionClient;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveRuntimeRunService(): RuntimeRunService;
	telemetry: AppTelemetry;
}
