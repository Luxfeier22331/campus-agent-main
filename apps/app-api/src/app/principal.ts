import type { Env } from "../config";
import { AppApiRouteError, routeErrorResponse } from "../http";
import type { ResolvedAppPrincipal } from "../modules/auth";
import { dependencyNotReadyResponse, sessionRequiredResponse } from "./responses";
import type { AppRequestScope } from "./types";

export async function resolvePrincipalForScope(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<ResolvedAppPrincipal | null> {
	return input.getPrincipal(input.request, input.env, {
		getAppAuth: input.scope.getAppAuth,
	});
}

export function principalResolutionErrorResponse(error: unknown): Response {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponse(error);
	}

	return dependencyNotReadyResponse();
}

export async function requireSessionPrincipal(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
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
