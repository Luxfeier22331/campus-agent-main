import type { Hono } from "hono";

import type { Env } from "../../config";
import type { AppDependencies, AppRequestScope, AppRuntimeReadinessResult } from "../types";
import { registerAccountAdminRoutes } from "./account-admin";
import { registerAuthRoutes } from "./auth";
import { registerCampusExperienceRoutes } from "./campus-experience";
import { registerCampusGroupsRoutes } from "./campus-groups";
import { registerChatRoutes } from "./chat";
import { registerDiningContentRoutes } from "./dining";
import { registerEmailAccessAdminRoutes } from "./email-access-admin";
import { registerFederationRoutes } from "./federation";
import { registerInternalRoutes } from "./internal";
import { registerNoticeRoutes } from "./notices";
import { registerProfileMemoryRoutes } from "./profile-memory";
import { registerRuntimeRoutes } from "./runtime";

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
	registerAccountAdminRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
	});
}
