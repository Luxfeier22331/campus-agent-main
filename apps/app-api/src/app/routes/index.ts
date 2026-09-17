import type { Hono } from "hono";
import type { Env } from "../../config";
import type { AppDependencies, AppRequestScope, AppRuntimeReadinessResult } from "../types";
import { registerAccountAdminRoutes } from "./account-admin";
import { registerAuthRoutes } from "./auth";
import { registerCampusExperienceRoutes } from "./campus-experience";
import { registerCampusGroupsRoutes } from "./campus-groups";
import { registerChatRoutes } from "./chat";
import { registerChatConversationAdminRoutes } from "./chat-conversation-admin";
import { registerChatFeedbackAdminRoutes } from "./chat-feedback-admin";
import { registerDiningContentRoutes } from "./dining";
import { registerDiningSubmissionRoutes } from "./dining-submissions";
import { registerEmailAccessAdminRoutes } from "./email-access-admin";
import { registerFederationRoutes } from "./federation";
import { registerInternalRoutes } from "./internal";
import { registerNoticeRoutes } from "./notices";
import { registerProfileMemoryRoutes } from "./profile-memory";
import { registerRuntimeRoutes } from "./runtime";
import { registerTransportRoutes } from "./transport";

export function registerAppRoutes(input: {
	accessInvitationEmailSender?: AppDependencies["accessInvitationEmailSender"];
	app: Hono<{ Bindings: Env }>;
	authHandler: NonNullable<AppDependencies["authHandler"]>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: NonNullable<AppDependencies["getPrincipal"]>;
	runtimeReadinessProbe: () => Promise<AppRuntimeReadinessResult>;
}) {
	registerRuntimeRoutes({
		app: input.app,
		env: input.env,
		runtimeReadinessProbe: input.runtimeReadinessProbe,
	});
	registerTransportRoutes({ app: input.app, createRequestScope: input.createRequestScope });
	registerAuthRoutes({
		app: input.app,
		authHandler: input.authHandler,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerFederationRoutes({
		app: input.app,
		authHandler: input.authHandler,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerChatRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerCampusExperienceRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerCampusGroupsRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerDiningContentRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerDiningSubmissionRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerProfileMemoryRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerNoticeRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerInternalRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerEmailAccessAdminRoutes({
		...(input.accessInvitationEmailSender
			? { accessInvitationEmailSender: input.accessInvitationEmailSender }
			: {}),
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerChatConversationAdminRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerChatFeedbackAdminRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
	registerAccountAdminRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
}
