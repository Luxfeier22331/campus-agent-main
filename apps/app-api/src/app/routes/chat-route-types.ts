import type { Hono } from "hono";
import type { Env } from "../../config";
import type { AppAuthResolutionInput, ResolvedAppPrincipal } from "../../modules/auth";
import type { AppRequestScope } from "../types";

export interface ChatRouteRegistrationInput {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
}
