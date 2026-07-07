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
					sourceRunToken: c.req.query("sourceRunToken") ?? null,
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

		const detail = await scope.resolveOperatorQueryService().getById({
			principal: resolved.principal,
			requestId: c.req.param("requestId"),
		});

		return jsonResponse(detail);
	});
}
