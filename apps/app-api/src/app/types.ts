import type { Env } from "../config";
import type { AccountAdminService } from "../modules/account-admin";
import type { AccountLifecycleService } from "../modules/account-lifecycle";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { AuthEmailSender } from "../modules/auth/reset-mail";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusGroupsService } from "../modules/campus-groups";
import type { ChatConversationService } from "../modules/chat";
import type { DiningContentService, DiningMapReadService } from "../modules/dining";
import type { DocsService } from "../modules/docs";
import type { EmailAccessService } from "../modules/email-access";
import type { ProfileMemoryService } from "../modules/profile-memory";
import type { ChatCommandService } from "../modules/runtime-command";
import type { RuntimeRunService } from "../modules/runtime-run";
import type { AppTelemetry } from "../modules/telemetry";

export interface AppDependencies {
	accountAdminService?: AccountAdminService;
	accountLifecycleService?: AccountLifecycleService;
	accessInvitationEmailSender?: AuthEmailSender;
	authHandler?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<Response> | Response;
	campusExperienceService?: CampusExperienceService;
	campusGroupsService?: CampusGroupsService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningMapReadService?: DiningMapReadService;
	diningContentService?: DiningContentService;
	docsService?: DocsService;
	emailAccessService?: EmailAccessService;
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
	resolveAccountAdminService(): AccountAdminService;
	resolveAccountLifecycleService(): AccountLifecycleService;
	resolveCampusExperienceService(): CampusExperienceService;
	resolveCampusGroupsService(): CampusGroupsService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningMapReadService(): DiningMapReadService;
	resolveDiningContentService(): DiningContentService;
	resolveDocsService(): DocsService;
	resolveEmailAccessService(): EmailAccessService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveRuntimeRunService(): RuntimeRunService;
	telemetry: AppTelemetry;
}
