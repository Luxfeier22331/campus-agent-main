import type { Env } from "../config";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusServicesTransportScheduleService } from "../modules/campus-services-transport-schedule";
import type { ChatConversationService } from "../modules/chat";
import type { DiningPublicReadService } from "../modules/dining";
import type { DocsService } from "../modules/docs";
import type {
	ExecutionControlCampusServicesProductPathPreflight,
	ExecutionControlRuntimePreflight,
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
	profileMemoryService?: ProfileMemoryService;
	runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
	runtimeRunService?: RuntimeRunService;
	telemetry?: AppTelemetry;
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
		executionControl: "ready" | "not_ready";
		executionRuntime: "ready" | "not_ready" | "not_required";
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
	resolveCampusServicesTransportScheduleService(): CampusServicesTransportScheduleService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningPublicReadService(): DiningPublicReadService;
	resolveDocsService(): DocsService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveRuntimeRunService(): RuntimeRunService;
	telemetry: AppTelemetry;
}
