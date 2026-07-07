import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { parseLimit, readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerOfficialWebRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/operator/official-web/sites", async (c) => {
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
			await scope.resolveOfficialWebQueryService().listSites({
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/official-web/sites/:siteId", async (c) => {
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
			await scope.resolveOfficialWebQueryService().getSiteById({
				principal: resolved.principal,
				siteId: c.req.param("siteId"),
			}),
		);
	});

	input.app.get("/api/operator/official-web/runs", async (c) => {
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
			await scope.resolveOfficialWebQueryService().listRuns({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					ingestionDispatchStatus: c.req.query("ingestionDispatchStatus") ?? null,
					limit: parseLimit(c.req.query("limit")),
					runIntent: c.req.query("runIntent") ?? null,
					siteId: c.req.query("siteId") ?? null,
					startedAfter: c.req.query("startedAfter") ?? null,
					startedBefore: c.req.query("startedBefore") ?? null,
					status: c.req.query("status") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/official-web/target-jobs", async (c) => {
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
			await scope.resolveOfficialWebTargetJobService().listTargetJobs({
				filters: {
					cursor: c.req.query("cursor") ?? null,
					limit: parseLimit(c.req.query("limit")),
					siteId: c.req.query("siteId") ?? null,
					status: c.req.query("status") ?? null,
					targetId: c.req.query("targetId") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/official-web/target-inventory", async (c) => {
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
			await scope.resolveOfficialWebTargetInventoryService().listTargetInventory({
				filters: {
					consumerFamily: c.req.query("consumerFamily") ?? null,
					ownerSurface: c.req.query("ownerSurface") ?? null,
					reviewState: c.req.query("reviewState") ?? null,
					siteId: c.req.query("siteId") ?? null,
				},
				principal: resolved.principal,
			}),
		);
	});

	input.app.get("/api/operator/official-web/target-inventory/:inventoryId", async (c) => {
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
			entry: await scope.resolveOfficialWebTargetInventoryService().getTargetInventoryEntryById({
				inventoryId: c.req.param("inventoryId"),
				principal: resolved.principal,
			}),
		});
	});

	input.app.post(
		"/api/operator/official-web/target-inventory/:inventoryId/release-gates",
		async (c) => {
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
				await scope.resolveOfficialWebTargetReleaseGateService().createReleaseGate({
					inventoryId: c.req.param("inventoryId"),
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
				}),
			);
		},
	);

	input.app.get("/api/operator/official-web/target-release-gates/:releaseId", async (c) => {
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
			await scope.resolveOfficialWebTargetReleaseGateService().getReleaseGateById({
				principal: resolved.principal,
				releaseId: c.req.param("releaseId"),
			}),
		);
	});

	input.app.get("/api/operator/official-web/target-jobs/:jobId", async (c) => {
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
			targetJob: await scope.resolveOfficialWebTargetJobService().getTargetJobById({
				jobId: c.req.param("jobId"),
				principal: resolved.principal,
			}),
		});
	});

	input.app.get("/api/operator/official-web/runs/:runId", async (c) => {
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
			run: await scope.resolveOfficialWebQueryService().getRunById({
				principal: resolved.principal,
				runId: c.req.param("runId"),
			}),
		});
	});
}
