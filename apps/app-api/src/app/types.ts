import type { Env } from "../config";
import type { AccountAdminService } from "../modules/account-admin";
import type { AccountLifecycleService } from "../modules/account-lifecycle";
import type { AppAuthGetter, AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import type { AuthEmailSender } from "../modules/auth/reset-mail";
import type { CampusExperienceService } from "../modules/campus-experience";
import type { CampusGroupsService } from "../modules/campus-groups";
import type { ChatConversationService } from "../modules/chat";
import type { ChatFeedbackQueryService } from "../modules/chat/feedback-query";
import type { OpsConversationQueryService } from "../modules/chat/ops-conversation-query";
import type { ChatAvailabilityService } from "../modules/chat-availability";
import type { DiningContentService, DiningMapReadService } from "../modules/dining";
import type { EmailAccessService } from "../modules/email-access";
import type { NoticeService } from "../modules/notices";
import type { ProfileMemoryService } from "../modules/profile-memory";
import type { ChatCommandService } from "../modules/runtime-command";
import type { RuntimeRunService } from "../modules/runtime-run";
import type { TransportScheduleService } from "../modules/transport";
import type { RequestRuntimeScopeDependencies } from "../request-runtime-scope";

export interface AppDependencies {
	runtimeScopeDependencies?: RequestRuntimeScopeDependencies;
	accountAdminService?: AccountAdminService;
	chatFeedbackQueryService?: ChatFeedbackQueryService;
	opsConversationQueryService?: OpsConversationQueryService;
	accountLifecycleService?: AccountLifecycleService;
	accessInvitationEmailSender?: AuthEmailSender;
	authHandler?: (
		request: Request,
		env: Env,
		input: Pick<AppAuthResolutionInput, "getAppAuth">,
	) => Promise<Response> | Response;
	campusExperienceService?: CampusExperienceService;
	campusGroupsService?: CampusGroupsService;
	chatAvailabilityService?: ChatAvailabilityService;
	chatConversationService?: ChatConversationService;
	chatCommandService?: ChatCommandService;
	diningMapReadService?: DiningMapReadService;
	diningContentService?: DiningContentService;
	transportScheduleService?: TransportScheduleService;
	emailAccessService?: EmailAccessService;
	noticeService?: NoticeService;
	getAppAuth?: AppAuthGetter;
	getPrincipal?: (
		request: Request,
		env: Env,
		input: AppAuthResolutionInput,
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
	getDb: import("../db/runtime").RuntimeDbGetter;
	getAppAuth: AppAuthGetter;
	resolveAccountAdminService(): AccountAdminService;
	resolveChatFeedbackQueryService(): ChatFeedbackQueryService;
	resolveOpsConversationQueryService(): OpsConversationQueryService;
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
	resolveTransportScheduleService(): TransportScheduleService;
}
