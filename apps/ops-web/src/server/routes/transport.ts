import type { Hono } from "hono";
import type { OpsAdmission, OpsOperatorContext } from "../ops-admission.ts";
import type { TransportStore } from "../transport-store-contract.ts";
import {
	type TransportOpsActor,
	TransportOpsRouteCreateSchema,
	TransportOpsRouteUpdateSchema,
	TransportOpsSchedulePeriodInputSchema,
} from "../transport-store-contract.ts";
import {
	admitOpsApiRequest,
	jsonError,
	OpsPathIdSchema,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

export function registerTransportRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	publicOrigin: string | null;
	store: TransportStore;
}): void {
	input.app.get("/api/ops/transport/routes", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_TRANSPORT_QUERY_INVALID", "线路查询不接受参数。", 400);
		}
		return context.json({ routes: await input.store.listRoutes() });
	});

	input.app.post("/api/ops/transport/routes", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const body = TransportOpsRouteCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 16 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_TRANSPORT_ROUTE_INVALID", "线路内容无效。", 400);
		}
		return context.json(
			{ route: await input.store.createRoute(toActor(operator), body.data) },
			201,
		);
	});

	input.app.patch("/api/ops/transport/routes/:routeId", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const routeId = context.req.param("routeId");
		const body = TransportOpsRouteUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 16 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(routeId).success && body.success)) {
			return jsonError("OPS_TRANSPORT_ROUTE_INVALID", "线路修改请求无效。", 400);
		}
		return context.json({
			route: await input.store.updateRoute(toActor(operator), routeId, body.data),
		});
	});

	input.app.delete("/api/ops/transport/routes/:routeId", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const routeId = context.req.param("routeId");
		if (!OpsPathIdSchema.safeParse(routeId).success) {
			return jsonError("OPS_TRANSPORT_ROUTE_INVALID", "线路标识无效。", 400);
		}
		await input.store.deleteRoute(toActor(operator), routeId);
		return new Response(null, { status: 204 });
	});

	input.app.get("/api/ops/transport/schedule-periods", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_TRANSPORT_QUERY_INVALID", "班次时间段查询不接受参数。", 400);
		}
		return context.json({ schedulePeriods: await input.store.listSchedulePeriods() });
	});

	input.app.post("/api/ops/transport/schedule-periods", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const body = TransportOpsSchedulePeriodInputSchema.safeParse(
			await readBoundedJson(context.req.raw, 512 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_TRANSPORT_SCHEDULE_INVALID", "班次时间段内容无效。", 400);
		}
		return context.json(
			{ schedulePeriod: await input.store.createSchedulePeriod(toActor(operator), body.data) },
			201,
		);
	});

	input.app.patch("/api/ops/transport/schedule-periods/:scheduleId", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const scheduleId = context.req.param("scheduleId");
		const body = TransportOpsSchedulePeriodInputSchema.safeParse(
			await readBoundedJson(context.req.raw, 512 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(scheduleId).success && body.success)) {
			return jsonError("OPS_TRANSPORT_SCHEDULE_INVALID", "班次时间段修改请求无效。", 400);
		}
		return context.json({
			schedulePeriod: await input.store.updateSchedulePeriod(
				toActor(operator),
				scheduleId,
				body.data,
			),
		});
	});

	input.app.delete("/api/ops/transport/schedule-periods/:scheduleId", async (context) => {
		const operator = await admitTransportWrite(input, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const scheduleId = context.req.param("scheduleId");
		if (!OpsPathIdSchema.safeParse(scheduleId).success) {
			return jsonError("OPS_TRANSPORT_SCHEDULE_INVALID", "班次时间段标识无效。", 400);
		}
		await input.store.deleteSchedulePeriod(toActor(operator), scheduleId);
		return new Response(null, { status: 204 });
	});
}

async function admitTransportWrite(
	input: { admission: OpsAdmission; publicOrigin: string | null },
	request: Request,
): Promise<OpsOperatorContext | Response> {
	const operator = await admitOpsApiRequest(input.admission, request);
	if (operator instanceof Response) {
		return operator;
	}
	if (!requestHasConfiguredOrigin(request, input.publicOrigin)) {
		return jsonError("OPS_TRANSPORT_ORIGIN_INVALID", "班车修改请求来源无效。", 403);
	}
	return operator;
}

function toActor(operator: OpsOperatorContext): TransportOpsActor {
	return {
		displayName: operator.displayName ?? operator.email ?? operator.operatorId,
		principalId: operator.operatorId,
	};
}
