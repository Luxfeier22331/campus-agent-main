import type { Env } from "../config";
import { AppApiRouteError, routeErrorResponse } from "../http";
import type { AppAuthResolutionInput, ResolvedAppPrincipal } from "../modules/auth";
import { sessionRequiredResponse } from "./responses";
import { authenticationDependencyFailure } from "./routes/auth-failure";
import type { AppRequestScope } from "./types";

export async function resolvePrincipalForScope(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<ResolvedAppPrincipal | null> {
	return input.getPrincipal(input.request, input.env, {
		getAppAuth: input.scope.getAppAuth,
		emailAccessService: input.scope.resolveEmailAccessService(),
	});
}

export function principalResolutionErrorResponse(error: unknown): Response {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponse(error);
	}

	return authenticationDependencyFailure({ error, source: "principal" });
}

export async function requireSessionPrincipal(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<
	| {
			principal: ResolvedAppPrincipal;
			response?: never;
	  }
	| {
			principal?: never;
			response: Response;
	  }
> {
	try {
		const principal = await resolvePrincipalForScope(input);
		if (!principal) {
			return { response: sessionRequiredResponse() };
		}

		return { principal };
	} catch (error) {
		return { response: principalResolutionErrorResponse(error) };
	}
}
