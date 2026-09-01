export interface CampusWorkerEnv {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	AUTH_TURNSTILE_SITE_KEY?: string;
	STATUS_WEB_PUBLIC_ORIGIN?: string;
}
