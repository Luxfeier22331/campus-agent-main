import type { Env } from "../config";
import type { AccountAdminService } from "../modules/account-admin";
import type { AccountLifecycleService } from "../modules/account-lifecycle";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { AuthEmailSender } from "../modules/auth/reset-mail";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusGroupsService } from "../modules/campus-groups";
import type { ChatConversationService } from "../modules/chat";
import type { ChatAvailabilityService } from "../modules/chat-availability";
import type { DiningContentService, DiningMapReadService } from "../modules/dining";
import type { EmailAccessService } from "../modules/email-access";
import type { NoticeService } from "../modules/notices";
import type { ProfileMemoryService } from "../modules/profile-memory";
import type { ChatCommandService } from "../modules/runtime-command";
import type { RuntimeRunService } from "../modules/runtime-run";

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
	chatAvailabilityService?: ChatAvailabilityService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningMapReadService?: DiningMapReadService;
	diningContentService?: DiningContentService;
	emailAccessService?: EmailAccessService;
	noticeService?: NoticeService;
	getAppAuth?: AppAuthGetter;
	getPrincipal?: (
		request: Request,
		env: Env,
		input?: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	profileMemoryService?: ProfileMemoryService;
	runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
	runtimeRunService?: RuntimeRunService;
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
	resolveChatAvailabilityService(): ChatAvailabilityService;
	resolveChatCommandService(): ChatCommandService;
	resolveChatConversationService(): ChatConversationService;
	resolveDiningMapReadService(): DiningMapReadService;
	resolveDiningContentService(): DiningContentService;
	resolveEmailAccessService(): EmailAccessService;
	resolveNoticeService(): NoticeService;
	resolveProfileMemoryService(): ProfileMemoryService;
	resolveRuntimeRunService(): RuntimeRunService;
}
