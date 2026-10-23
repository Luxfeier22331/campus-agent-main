import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { errorEnvelope, jsonResponse } from "../../http";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerCampusGroupsRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/campus-groups/catalog", async () => {
		const catalog = await input.createRequestScope().resolveCampusGroupsService().getCatalog();
		return jsonResponse(catalog, {
			headers: {
				"cache-control": "no-store",
			},
		});
	});

	input.app.put("/api/internal/ops/campus-groups/catalog", async (c) => {
		const authResponse = requireOpsToken(c.req.raw, input.env);
		if (authResponse) {
			return authResponse;
		}
		const catalog = await input
			.createRequestScope()
			.resolveCampusGroupsService()
			.replaceCatalog(await readJsonRequestBody(c.req.raw));
		return jsonResponse(catalog, { headers: { "cache-control": "no-store" } });
	});
}

function requireOpsToken(request: Request, env: Env): Response | null {
	const expected = env.OPS_WEB_INTERNAL_TOKEN?.trim();
	const provided = request.headers
		.get("authorization")
		?.match(/^Bearer\s+(.+)$/iu)?.[1]
		?.trim();
	if (!(expected && provided)) {
		return jsonResponse(
			errorEnvelope({
				code: "ops_admin_auth_required",
				message: "运维服务凭据无效。",
				retryable: false,
			}),
			{ status: 401 },
		);
	}
	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	if (
		expectedBytes.length !== providedBytes.length ||
		!timingSafeEqual(expectedBytes, providedBytes)
	) {
		return jsonResponse(
			errorEnvelope({
				code: "ops_admin_auth_required",
				message: "运维服务凭据无效。",
				retryable: false,
			}),
			{ status: 401 },
		);
	}
	return null;
}
