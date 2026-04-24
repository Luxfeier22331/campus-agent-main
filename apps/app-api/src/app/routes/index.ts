import type { Hono } from "hono";

import type { Env } from "../../config";
import type { AppDependencies, AppRequestScope, AppRuntimeReadinessResult } from "../types";
import { registerAuthRoutes } from "./auth";
import { registerChatRoutes } from "./chat";
import { registerDocsRoutes } from "./docs";
import { registerInternalRoutes } from "./internal";
import { registerOfficialWebRoutes } from "./official-web";
import { registerOperatorRoutes } from "./operator";
import { registerRuntimeRoutes } from "./runtime";

export function registerAppRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	authHandler: NonNullable<AppDependencies["authHandler"]>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: NonNullable<AppDependencies["getPrincipal"]>;
	officialWebExecutionStatusService: NonNullable<
		AppDependencies["officialWebExecutionStatusService"]
	>;
	officialWebPlannerService: NonNullable<AppDependencies["officialWebPlannerService"]>;
	runtimeReadinessProbe: () => Promise<AppRuntimeReadinessResult>;
	scheduleRequestProjectionDrain?: AppDependencies["scheduleRequestProjectionDrain"];
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
	registerChatRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
		scheduleRequestProjectionDrain: input.scheduleRequestProjectionDrain,
	});
	registerDocsRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
	registerOfficialWebRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
		officialWebPlannerService: input.officialWebPlannerService,
	});
	registerInternalRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		officialWebExecutionStatusService: input.officialWebExecutionStatusService,
		scheduleRequestProjectionDrain: input.scheduleRequestProjectionDrain,
	});
	registerOperatorRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
	});
}
