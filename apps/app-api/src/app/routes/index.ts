import type { Hono } from "hono";

import type { Env } from "../../config";
import type {
	AppDependencies,
	AppDocsReadinessResult,
	AppRequestScope,
	AppRuntimeReadinessResult,
} from "../types";
import { registerAuthRoutes } from "./auth";
import { registerCampusExperienceRoutes } from "./campus-experience";
import { registerChatRoutes } from "./chat";
import { registerDocsRoutes } from "./docs";
import { registerFederationRoutes } from "./federation";
import { registerInternalRoutes } from "./internal";
import { registerProfileMemoryRoutes } from "./profile-memory";
import { registerRuntimeRoutes } from "./runtime";

export function registerAppRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	authHandler: NonNullable<AppDependencies["authHandler"]>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: NonNullable<AppDependencies["getPrincipal"]>;
	docsReadinessProbe: (releaseId: string) => Promise<AppDocsReadinessResult>;
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
	registerDocsRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		docsReadinessProbe: input.docsReadinessProbe,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerProfileMemoryRoutes({
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
}
