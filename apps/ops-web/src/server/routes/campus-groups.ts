import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";
import type { Hono } from "hono";
import type { createCampusGroupsAdminClient } from "../campus-groups-client.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	jsonError,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

export class CampusGroupsRequestError extends Error {}

export function registerCampusGroupsRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	client: ReturnType<typeof createCampusGroupsAdminClient>;
	publicOrigin: string | null;
}): void {
	const { admission, app, client: campusGroupsClient, publicOrigin } = input;
	app.get("/api/ops/groups/catalog", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response
			? operator
			: context.json(await campusGroupsClient.getCatalog());
	});

	app.put("/api/ops/groups/catalog", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError("OPS_GROUPS_ORIGIN_INVALID", "同好群修改请求来源无效。", 403);
		}
		return context.json(
			await campusGroupsClient.replaceCatalog(
				parseCampusGroupsCatalog(await readBoundedJson(context.req.raw, 8 * 1024 * 1024)),
			),
		);
	});
}

function parseCampusGroupsCatalog(value: unknown): CampusGroupsCatalog {
	const parsed = CampusGroupsCatalogSchema.safeParse(value);
	if (!parsed.success) {
		throw new CampusGroupsRequestError("同好群目录无效。");
	}
	return parsed.data;
}
