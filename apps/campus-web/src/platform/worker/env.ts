import { type EnvironmentLane, isEnvironmentLane } from "campus-contracts/environment-lanes";

export interface CampusWorkerEnv {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	AUTH_TURNSTILE_SITE_KEY?: string;
	DEPLOYMENT_ENVIRONMENT?: string;
	STATUS_WEB_PUBLIC_ORIGIN?: string;
}

// Deployed environments share the public hostname and are selected by lane.
export function resolveDeploymentLane(env: CampusWorkerEnv): EnvironmentLane | null {
	const environment = env.DEPLOYMENT_ENVIRONMENT?.trim();
	return isEnvironmentLane(environment) ? environment : null;
}
