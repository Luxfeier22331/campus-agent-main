import { createHash, timingSafeEqual } from "node:crypto";
import {
	type IngestionTaskRegistryCatalog,
	parseIngestionTaskEnvelope,
	parseIngestionWorkflowStatus as parseTaskStatus,
} from "ingest-core";
import {
	OfficialWebControlPlaneError,
	officialWebErrorEnvelope,
} from "./official-web-control-plane-errors";
import type { OfficialWebControlPlaneService } from "./official-web-control-plane-service";
import type { OfficialWebCollectorPrincipal } from "./official-web-control-plane-types";
import type { OfficialWebExecutionStatusService } from "./official-web-execution-status-service";
import type { OfficialWebProjectionProjector } from "./official-web-projection-service";
import type { IngestionWorkflowStarter } from "./temporal-client";
import type { IngestionTaskStore } from "./types";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

export interface IngestionControlServiceTokens {
	adminToken?: string | null;
	appApiProjectionToken?: string | null;
	officialWebCollectorToken?: string | null;
	officialWebExecutionStatusToken?: string | null;
	officialWebProjectionToken?: string | null;
}

type IngestionControlPrincipalClass =
	| "admin"
	| "app_api_projection_reader"
	| "official_web_collector"
	| "official_web_execution_status_writer"
	| "official_web_projection_worker";

interface IngestionControlPrincipal {
	kind: "service";
	serviceClass: IngestionControlPrincipalClass;
	serviceId: string;
}

export function createIngestionControlHandler(input: {
	store: IngestionTaskStore;
	registryCatalog: IngestionTaskRegistryCatalog;
	officialWebCollectorToken?: string | null;
	officialWebControlPlaneService?: OfficialWebControlPlaneService;
	officialWebExecutionStatusService?: OfficialWebExecutionStatusService;
	officialWebProjectionProjector?: OfficialWebProjectionProjector;
	serviceTokens?: IngestionControlServiceTokens;
	workflowStarter?: IngestionWorkflowStarter;
}): IngestionControlHandler {
	const serviceTokens = normalizeServiceTokens(input);
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const pathname = url.pathname;
		try {
			if (request.method === "POST" && pathname === "/internal/ingestion/tasks") {
				requireServicePrincipal(request, serviceTokens, "admin");
				const task = parseIngestionTaskEnvelope(await request.json());
				input.registryCatalog.requireTask(task);
				if (!input.workflowStarter) {
					return jsonResponse({ error: "ingestion workflow starter is required" }, 503);
				}
				const admission = await input.store.admitTask(task);
				const admitted = admission.record;
				if (!admission.created && admitted.status !== "accepted") {
					return jsonResponse(admitted, 200);
				}
				try {
					await input.workflowStarter.startTask(admitted);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "ingestion workflow start failed";
					return jsonResponse({ error: errorMessage }, 503);
				}
				return jsonResponse(admitted, 202);
			}
			if (
				request.method === "GET" &&
				pathname === "/internal/ingestion/operator-projection/tasks"
			) {
				requireServicePrincipal(request, serviceTokens, "app_api_projection_reader");
				return jsonResponse(
					await input.store.listOperatorTaskProjections({
						collection: url.searchParams.get("collection"),
						corpus: url.searchParams.get("corpus"),
						limit: parseLimit(url.searchParams.get("limit")),
						runId: url.searchParams.get("run_id") ?? url.searchParams.get("runId"),
						status: parseTaskStatus(url.searchParams.get("status")),
					}),
				);
			}
			if (isRetiredExecutorRoute(request, pathname)) {
				return jsonResponse({ error: "not_found" }, 404);
			}
			const getTaskMatch = pathname.match(/^\/internal\/ingestion\/tasks\/([^/]+)$/u);
			if (request.method === "GET" && getTaskMatch) {
				requireServicePrincipal(request, serviceTokens, "admin");
				const task = await input.store.getTask(getTaskMatch[1]);
				return task ? jsonResponse(task) : jsonResponse({ error: "not_found" }, 404);
			}
			if (request.method === "GET" && pathname === "/healthz") {
				return jsonResponse({ status: "ok" });
			}
			if (request.method === "GET" && pathname === "/readyz") {
				return jsonResponse({ status: "ready" });
			}
			const officialWebResponse = await maybeHandleOfficialWebControlPlaneRequest({
				executionStatusService: input.officialWebExecutionStatusService,
				pathname,
				projectionProjector: input.officialWebProjectionProjector,
				request,
				service: input.officialWebControlPlaneService,
				serviceTokens,
			});
			if (officialWebResponse) {
				return officialWebResponse;
			}
			return jsonResponse({ error: "not_found" }, 404);
		} catch (error) {
			if (error instanceof OfficialWebControlPlaneError) {
				return jsonResponse(officialWebErrorEnvelope(error), error.status);
			}
			return jsonResponse(
				{ error: error instanceof Error ? error.message : "ingestion control request failed" },
				400,
			);
		}
	};
}

function isRetiredExecutorRoute(request: Request, pathname: string): boolean {
	return (
		(request.method === "GET" && pathname === "/internal/ingestion/tasks/next") ||
		(request.method === "POST" &&
			(pathname === "/internal/ingestion/tasks/claim" ||
				/^\/internal\/ingestion\/tasks\/[^/]+\/(?:heartbeat|complete|fail)$/u.test(pathname)))
	);
}

async function maybeHandleOfficialWebControlPlaneRequest(input: {
	executionStatusService?: OfficialWebExecutionStatusService;
	pathname: string;
	projectionProjector?: OfficialWebProjectionProjector;
	request: Request;
	service?: OfficialWebControlPlaneService;
	serviceTokens: Required<IngestionControlServiceTokens>;
}): Promise<Response | null> {
	if (!input.pathname.startsWith("/internal/ingestion/official-web/")) {
		return null;
	}
	if (input.request.method !== "POST") {
		return jsonResponse({ error: "not_found" }, 404);
	}
	if (input.pathname === "/internal/ingestion/official-web/projection:drain") {
		requireServicePrincipal(input.request, input.serviceTokens, "official_web_projection_worker");
		if (!input.projectionProjector) {
			return jsonResponse({ error: "official_web_projection_projector_not_configured" }, 503);
		}
		const payload = (await input.request.json()) as Record<string, unknown>;
		return jsonResponse(
			await input.projectionProjector.drain({
				limit: parseOptionalPositiveInteger(payload.limit),
			}),
		);
	}
	const executionStatusMatch = input.pathname.match(
		/^\/internal\/ingestion\/official-web\/runs\/([^/]+)\/ingestion-execution$/u,
	);
	if (executionStatusMatch) {
		requireServicePrincipal(
			input.request,
			input.serviceTokens,
			"official_web_execution_status_writer",
		);
		if (!input.executionStatusService) {
			return jsonResponse({ error: "official_web_execution_status_not_configured" }, 503);
		}
		return jsonResponse(
			await input.executionStatusService.updateRunExecutionStatus({
				payload: (await input.request.json()) as Record<string, unknown>,
				runId: executionStatusMatch[1],
			}),
		);
	}
	const principal = toOfficialWebCollectorPrincipal(
		requireServicePrincipal(input.request, input.serviceTokens, "official_web_collector"),
	);
	if (input.pathname === "/internal/ingestion/official-web/runs") {
		if (!input.service) {
			return jsonResponse({ error: "official_web_control_plane_not_configured" }, 503);
		}
		return jsonResponse(
			await input.service.start({
				payload: (await input.request.json()) as Record<string, unknown>,
				principal,
			}),
		);
	}
	if (input.pathname === "/internal/ingestion/official-web/plans:resolve") {
		if (!input.service) {
			return jsonResponse({ error: "official_web_control_plane_not_configured" }, 503);
		}
		return jsonResponse(
			await input.service.resolvePlan({
				payload: (await input.request.json()) as Record<string, unknown>,
				principal,
			}),
		);
	}
	if (!input.service) {
		return jsonResponse({ error: "official_web_control_plane_not_configured" }, 503);
	}
	const heartbeatMatch = input.pathname.match(
		/^\/internal\/ingestion\/official-web\/runs\/([^/]+)\/heartbeats$/u,
	);
	if (heartbeatMatch) {
		return jsonResponse(
			await input.service.heartbeat({
				payload: (await input.request.json()) as Record<string, unknown>,
				principal,
				runId: heartbeatMatch[1],
			}),
		);
	}
	const finalizeMatch = input.pathname.match(
		/^\/internal\/ingestion\/official-web\/runs\/([^/]+)\/finalize$/u,
	);
	if (finalizeMatch) {
		return jsonResponse(
			await input.service.finalize({
				payload: (await input.request.json()) as Record<string, unknown>,
				principal,
				runId: finalizeMatch[1],
			}),
		);
	}
	return jsonResponse({ error: "not_found" }, 404);
}

function normalizeServiceTokens(input: {
	officialWebCollectorToken?: string | null;
	serviceTokens?: IngestionControlServiceTokens;
}): Required<IngestionControlServiceTokens> {
	return {
		adminToken: input.serviceTokens?.adminToken?.trim() || null,
		appApiProjectionToken: input.serviceTokens?.appApiProjectionToken?.trim() || null,
		officialWebCollectorToken:
			input.serviceTokens?.officialWebCollectorToken?.trim() ||
			input.officialWebCollectorToken?.trim() ||
			null,
		officialWebExecutionStatusToken:
			input.serviceTokens?.officialWebExecutionStatusToken?.trim() || null,
		officialWebProjectionToken: input.serviceTokens?.officialWebProjectionToken?.trim() || null,
	};
}

function requireServicePrincipal(
	request: Request,
	tokens: Required<IngestionControlServiceTokens>,
	serviceClass: IngestionControlPrincipalClass,
): IngestionControlPrincipal {
	const configuredToken = tokenForServiceClass(tokens, serviceClass);
	const requestToken = parseBearerToken(request.headers.get("authorization"));
	if (!configuredToken) {
		throw new OfficialWebControlPlaneError({
			code: "service_principal_not_configured",
			message: `${serviceClass} bearer token is not configured.`,
			retryable: true,
			status: 503,
		});
	}
	if (!(configuredToken && requestToken && constantTimeEqual(configuredToken, requestToken))) {
		throw new OfficialWebControlPlaneError({
			code: "service_credential_required",
			message: `${serviceClass} bearer token is required.`,
			retryable: false,
			status: 401,
		});
	}
	return {
		kind: "service",
		serviceClass,
		serviceId: serviceIdForServiceClass(serviceClass),
	};
}

function toOfficialWebCollectorPrincipal(
	principal: IngestionControlPrincipal,
): OfficialWebCollectorPrincipal {
	if (principal.serviceClass !== "official_web_collector") {
		throw new OfficialWebControlPlaneError({
			code: "forbidden",
			message: "Official web collector access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
	return {
		kind: "service",
		serviceClass: "official_web_collector",
		serviceId: "source-collector/official-web",
	};
}

function tokenForServiceClass(
	tokens: Required<IngestionControlServiceTokens>,
	serviceClass: IngestionControlPrincipalClass,
): string | null {
	switch (serviceClass) {
		case "admin":
			return tokens.adminToken;
		case "app_api_projection_reader":
			return tokens.appApiProjectionToken;
		case "official_web_collector":
			return tokens.officialWebCollectorToken;
		case "official_web_execution_status_writer":
			return tokens.officialWebExecutionStatusToken;
		case "official_web_projection_worker":
			return tokens.officialWebProjectionToken;
		default:
			return assertNever(serviceClass);
	}
}

function serviceIdForServiceClass(serviceClass: IngestionControlPrincipalClass): string {
	switch (serviceClass) {
		case "admin":
			return "ingestion-control/admin";
		case "app_api_projection_reader":
			return "app-api/ingestion-projection";
		case "official_web_collector":
			return "source-collector/official-web";
		case "official_web_execution_status_writer":
			return "ingestion-control/official-web-execution-status";
		case "official_web_projection_worker":
			return "ingestion-control/official-web-projection";
		default:
			return assertNever(serviceClass);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unsupported service principal class: ${String(value)}`);
}

function parseBearerToken(value: string | null): string | null {
	const match = value?.match(/^Bearer\s+(.+)$/iu);
	return match?.[1]?.trim() || null;
}

function constantTimeEqual(left: string, right: string): boolean {
	const leftHash = createHash("sha256").update(left).digest();
	const rightHash = createHash("sha256").update(right).digest();
	return timingSafeEqual(leftHash, rightHash);
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function parseLimit(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
	if (value == null) {
		return;
	}
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new OfficialWebControlPlaneError({
			code: "validation_failed",
			details: { field: "limit" },
			message: "limit must be a positive integer.",
			retryable: false,
			status: 422,
		});
	}
	return parsed;
}
