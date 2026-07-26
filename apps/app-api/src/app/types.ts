import type { Env } from "../config";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusGroupsService } from "../modules/campus-groups";
import type { CampusServicesTransportScheduleService } from "../modules/campus-services-transport-schedule";
import type { ChatConversationService } from "../modules/chat";
import type { DiningContentService, DiningMapReadService } from "../modules/dining";
import type { DocsService } from "../modules/docs";
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
	campusGroupsService?: CampusGroupsService;
	campusServicesTransportScheduleService?: CampusServicesTransportScheduleService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningMapReadService?: DiningMapReadService;
	diningContentService?: DiningContentService;
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

type AppRuntimeDependencyName = "auth" | "database";
export interface AppRuntimeReadinessResult {
	dependencies: {
		auth: "ready" | "not_ready";
		database: "ready" | "not_ready";
	};
	failed: Partial<Record<AppRuntimeDependencyName, string>>;
}

export interface AppRequestScope {
	getAppAuth: AppAuthGetter;
	resolveCampusExperienceService(): CampusExperienceService;
	resolveCampusGroupsService(): CampusGroupsService;
	resolveCampusServicesTransportScheduleService(): CampusServicesTransportScheduleService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningMapReadService(): DiningMapReadService;
	resolveDiningContentService(): DiningContentService;
	resolveDocsService(): DocsService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveRuntimeRunService(): RuntimeRunService;
	telemetry: AppTelemetry;
}
