import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { parseLimit, readOperatorAggregateFilters } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerOperatorRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/operator/overview", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getOverview({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/runtime/health", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getRuntimeHealth({
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/quality/summary", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getQualitySummary({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/quality/timeseries", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getQualityTimeseries({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/quality/badcases", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listQualityBadcases({
				filters: {
					causeClass: c.req.query("causeClass") ?? null,
					cursor: c.req.query("cursor") ?? null,
					detectedBy: c.req.query("detectedBy") ?? null,
					limit: parseLimit(c.req.query("limit")),
					selectedCapability: c.req.query("selectedCapability") ?? null,
					status: c.req.query("status") ?? null,
					surface: c.req.query("surface") ?? null,
					window: c.req.query("window") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/quality/eval-candidates", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listQualityEvalCandidates({
				filters: {
					causeClass: c.req.query("causeClass") ?? null,
					cursor: c.req.query("cursor") ?? null,
					detectedBy: c.req.query("detectedBy") ?? null,
					limit: parseLimit(c.req.query("limit")),
					selectedCapability: c.req.query("selectedCapability") ?? null,
					status: c.req.query("status") ?? null,
					surface: c.req.query("surface") ?? null,
					window: c.req.query("window") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/intent/summary", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getIntentSummary({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/evals/coverage", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getEvalCoverage({
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/authenticated-notices/processing", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveAuthenticatedNoticeProcessingQueryService().list({
				filters: {
					candidateKind: c.req.query("candidateKind") ?? null,
					cursor: c.req.query("cursor") ?? null,
					limit: parseLimit(c.req.query("limit")),
					noticeId: c.req.query("noticeId") ?? null,
					q: c.req.query("q") ?? null,
					queueStatus: c.req.query("queueStatus") ?? null,
					replayBatchId: c.req.query("replayBatchId") ?? null,
					runId: c.req.query("runId") ?? null,
					status: c.req.query("status") ?? null,
					targetSurface: c.req.query("targetSurface") ?? null,
					updatedAfter: c.req.query("updatedAfter") ?? null,
					updatedBefore: c.req.query("updatedBefore") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/authenticated-notices/processing/:noticeId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse({
			notice: await scope.resolveAuthenticatedNoticeProcessingQueryService().getByNoticeId({
				noticeId: c.req.param("noticeId"),
				principal: resolved.principal,
			}),
		});
	});

	input.app.get("/api/operator/authenticated-notices/run-processing", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveAuthenticatedNoticeRunProcessingQueryService().list({
				filters: {
					collectorRunToken: c.req.query("collectorRunToken") ?? null,
					cursor: c.req.query("cursor") ?? null,
					limit: parseLimit(c.req.query("limit")),
					q: c.req.query("q") ?? null,
					queueStatus: c.req.query("queueStatus") ?? null,
					replayBatchId: c.req.query("replayBatchId") ?? null,
					runId: c.req.query("runId") ?? null,
					siteId: c.req.query("siteId") ?? null,
					sourceSurface: c.req.query("sourceSurface") ?? null,
					status: c.req.query("status") ?? null,
					updatedAfter: c.req.query("updatedAfter") ?? null,
					updatedBefore: c.req.query("updatedBefore") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/authenticated-notices/run-processing/:id", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse({
			run: await scope.resolveAuthenticatedNoticeRunProcessingQueryService().getById({
				id: c.req.param("id"),
				principal: resolved.principal,
			}),
		});
	});

	input.app.get("/api/operator/official-web/release-tasks", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOfficialWebReleaseTaskProcessingQueryService().list({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					inventoryId: c.req.query("inventoryId") ?? null,
					jobId: c.req.query("jobId") ?? null,
					limit: parseLimit(c.req.query("limit")),
					q: c.req.query("q") ?? null,
					runId: c.req.query("runId") ?? null,
					selectedWriteTarget: c.req.query("selectedWriteTarget") ?? null,
					status: c.req.query("status") ?? null,
					taskType: c.req.query("taskType") ?? null,
					updatedAfter: c.req.query("updatedAfter") ?? null,
					updatedBefore: c.req.query("updatedBefore") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/official-web/release-tasks/:id", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse({
			task: await scope.resolveOfficialWebReleaseTaskProcessingQueryService().getById({
				id: c.req.param("id"),
				principal: resolved.principal,
			}),
		});
	});

	input.app.get("/api/operator/ingestion/tasks", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveIngestionTaskProjectionClient().listTasks({
				query: new URL(c.req.raw.url).searchParams,
			}),
		);
	});

	input.app.get("/api/operator/runtime/temporal-task-queues", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listTemporalTaskQueues({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					limit: parseLimit(c.req.query("limit")),
					taskQueue: c.req.query("taskQueue") ?? null,
					taskQueueKind: c.req.query("taskQueueKind") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/runtime/autoscaler/decisions", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listAutoscalerDecisions({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					decision: c.req.query("decision") ?? null,
					limit: parseLimit(c.req.query("limit")),
					targetService: c.req.query("targetService") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/runtime/autoscaler/actuations", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listAutoscalerActuations({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					decisionId: c.req.query("decisionId") ?? null,
					limit: parseLimit(c.req.query("limit")),
					status: c.req.query("status") ?? null,
					targetService: c.req.query("targetService") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/intent/timeseries", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getIntentTimeseries({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/safety/summary", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getSafetySummary({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/safety/anomalies", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listSafetyAnomalies({
				filters: {
					anomalyCode: c.req.query("anomalyCode") ?? null,
					cursor: c.req.query("cursor") ?? null,
					limit: parseLimit(c.req.query("limit")),
					selectedCapability: c.req.query("selectedCapability") ?? null,
					severity: c.req.query("severity") ?? null,
					status: c.req.query("status") ?? null,
					surface: c.req.query("surface") ?? null,
					window: c.req.query("window") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/cost/summary", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getCostSummary({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/cost/timeseries", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getCostTimeseries({
				filters: readOperatorAggregateFilters(c.req),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/audit", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().listAudit({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					eventType: c.req.query("eventType") ?? null,
					limit: parseLimit(c.req.query("limit")),
					principalType: c.req.query("principalType") ?? null,
					requestId: c.req.query("requestId") ?? null,
					selectedCapability: c.req.query("selectedCapability") ?? null,
					status: c.req.query("status") ?? null,
					surface: c.req.query("surface") ?? null,
					traceId: c.req.query("traceId") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/audit/:auditEventId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getAuditById({
				auditEventId: c.req.param("auditEventId"),
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/requests", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveOperatorQueryService().list({
			filters: {
				conversationId: c.req.query("conversationId") ?? null,
				cursor: c.req.query("cursor") ?? null,
				limit: parseLimit(c.req.query("limit")),
				q: c.req.query("q") ?? null,
				requestId: c.req.query("requestId") ?? null,
				status: c.req.query("status") ?? null,
				surface: c.req.query("surface") ?? null,
			},
			principal: resolved.principal,
		});

		return jsonResponse(response);
	});

	input.app.get("/api/operator/requests/:requestId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const request = await scope.resolveOperatorQueryService().getById({
			principal: resolved.principal,
			requestId: c.req.param("requestId"),
		});

		return jsonResponse({ request });
	});

	input.app.get("/api/operator/requests/:requestId/observability", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const service = scope.resolveOperatorQueryService();
		const projection = await service.getObservabilityById({
			principal: resolved.principal,
			requestId: c.req.param("requestId"),
		});
		const langfuseEvalBacklinks = await service.getLangfuseEvalBacklinksByTraceId({
			principal: resolved.principal,
			traceId: projection.request.traceId,
		});

		return jsonResponse({
			...projection,
			links: {
				...projection.links,
				langfuseEvalBacklinks: langfuseEvalBacklinks.backlinks,
			},
		});
	});

	input.app.get("/api/operator/langfuse/eval-backlinks", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveOperatorQueryService().getLangfuseEvalBacklinksByTraceId({
				principal: resolved.principal,
				traceId: c.req.query("traceId") ?? "",
			}),
		);
	});
}
