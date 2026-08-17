import {
	DiningMenuItemCreateSchema,
	DiningMenuItemMoveSchema,
	DiningMenuItemUpdateSchema,
	DiningMenuOrderSchema,
	DiningOpsReviewCreateSchema,
	DiningOpsReviewUpdateSchema,
	DiningOpsReviewVisibilitySchema,
	DiningReportResolutionSchema,
} from "@campus-agent/dining/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { DiningDraftUpdateSchema, DiningRevisionSchema } from "../../shared/dining-contract.ts";
import type {
	DiningMapStore,
	DiningMenuStore,
	DiningReviewStore,
} from "../dining-store-contract.ts";
import type { OpsAdmission, OpsOperatorContext } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	jsonError,
	OpsPathIdSchema,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

const DiningReviewListQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		menu_item_id: OpsPathIdSchema.optional(),
		q: z.string().trim().min(1).max(200).optional(),
		visibility: z.enum(["visible", "hidden", "deleted"]).optional(),
		window_id: OpsPathIdSchema.optional(),
	})
	.strict();
const DiningReportListQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		status: z.enum(["pending", "resolved"]).default("pending"),
	})
	.strict();

export function registerDiningRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	diningMapStore: DiningMapStore;
	diningMenuStore: DiningMenuStore;
	diningReviewStore: DiningReviewStore;
	publicOrigin: string | null;
}): void {
	input.app.get("/api/ops/dining", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "食堂地图查询不接受参数。", 400);
		}
		return context.json(await input.diningMapStore.getState());
	});

	input.app.put("/api/ops/dining/draft", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningDraftUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_DINING_DRAFT_INVALID", "食堂地图保存请求无效。", 400);
		}
		return context.json({
			draft: await input.diningMapStore.saveDraft(
				toDiningActor(operator),
				body.data.bundle,
				body.data.expectedRevision,
			),
		});
	});

	input.app.post("/api/ops/dining/publish", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningRevisionSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		if (!body.success) {
			return jsonError("OPS_DINING_PUBLISH_INVALID", "食堂地图发布请求无效。", 400);
		}
		return context.json({
			release: await input.diningMapStore.publish(
				toDiningActor(operator),
				body.data.expectedRevision,
			),
		});
	});

	input.app.get("/api/ops/dining/releases", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "地图版本查询不接受参数。", 400);
		}
		return context.json(await input.diningMapStore.listReleases());
	});

	input.app.post("/api/ops/dining/releases/:releaseId/restore", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const releaseId = context.req.param("releaseId");
		const body = DiningRevisionSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		if (!(OpsPathIdSchema.safeParse(releaseId).success && body.success)) {
			return jsonError("OPS_DINING_RESTORE_INVALID", "食堂地图恢复请求无效。", 400);
		}
		return context.json(
			await input.diningMapStore.restore(
				toDiningActor(operator),
				releaseId,
				body.data.expectedRevision,
			),
		);
	});

	input.app.get("/api/ops/dining/menu-items", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "菜单查询不接受参数。", 400);
		}
		return context.json({ items: await input.diningMenuStore.listMenuItems() });
	});

	input.app.post("/api/ops/dining/menu-items", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningMenuItemCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品内容无效。", 400);
		}
		return context.json(
			{ item: await input.diningMenuStore.createMenuItem(toDiningActor(operator), body.data) },
			201,
		);
	});

	input.app.patch("/api/ops/dining/menu-items/:menuItemId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const menuItemId = context.req.param("menuItemId");
		const body = DiningMenuItemUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(menuItemId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品修改请求无效。", 400);
		}
		return context.json({
			item: await input.diningMenuStore.updateMenuItem(toDiningActor(operator), menuItemId, {
				...(body.data.name ? { name: body.data.name } : {}),
				...(body.data.priceText === undefined ? {} : { priceText: body.data.priceText }),
			}),
		});
	});

	input.app.post("/api/ops/dining/menu-items/:menuItemId/move", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const menuItemId = context.req.param("menuItemId");
		const body = DiningMenuItemMoveSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(menuItemId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品迁移请求无效。", 400);
		}
		return context.json({
			item: await input.diningMenuStore.moveMenuItem(
				toDiningActor(operator),
				menuItemId,
				body.data.windowId,
			),
		});
	});

	for (const action of ["archive", "restore"] as const) {
		input.app.post(`/api/ops/dining/menu-items/:menuItemId/${action}`, async (context) => {
			const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
			if (operator instanceof Response) {
				return operator;
			}
			const menuItemId = context.req.param("menuItemId");
			if (!OpsPathIdSchema.safeParse(menuItemId).success) {
				return jsonError("OPS_DINING_MENU_INVALID", "菜品标识无效。", 400);
			}
			const item =
				action === "archive"
					? await input.diningMenuStore.archiveMenuItem(toDiningActor(operator), menuItemId)
					: await input.diningMenuStore.restoreMenuItem(toDiningActor(operator), menuItemId);
			return context.json({ item });
		});
	}

	input.app.put("/api/ops/dining/windows/:windowId/menu-order", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const windowId = context.req.param("windowId");
		const body = DiningMenuOrderSchema.safeParse(await readBoundedJson(context.req.raw, 64 * 1024));
		if (!(OpsPathIdSchema.safeParse(windowId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品排序请求无效。", 400);
		}
		return context.json({
			items: await input.diningMenuStore.reorderMenuItems(
				toDiningActor(operator),
				windowId,
				body.data.menuItemIds,
			),
		});
	});

	input.app.get("/api/ops/dining/reviews", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningReviewListQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_DINING_QUERY_INVALID", "评价查询参数无效。", 400);
		}
		return context.json(
			await input.diningReviewStore.listReviews({
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				limit: query.data.limit,
				...(query.data.menu_item_id ? { menuItemId: query.data.menu_item_id } : {}),
				...(query.data.q ? { q: query.data.q } : {}),
				...(query.data.visibility ? { visibility: query.data.visibility } : {}),
				...(query.data.window_id ? { windowId: query.data.window_id } : {}),
			}),
		);
	});

	input.app.get("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		if (!OpsPathIdSchema.safeParse(reviewId).success) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价标识无效。", 400);
		}
		return context.json(await input.diningReviewStore.getReview(reviewId));
	});

	input.app.post("/api/ops/dining/reviews", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningOpsReviewCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		const menuItemId = OpsPathIdSchema.safeParse(context.req.query("menu_item_id"));
		const idempotencyKey = context.req.header("idempotency-key")?.trim();
		if (!(body.success && menuItemId.success && idempotencyKey) || idempotencyKey.length > 200) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价创建请求无效。", 400);
		}
		return context.json(
			{
				review: await input.diningReviewStore.createReview(toDiningActor(operator), {
					...body.data,
					idempotencyKey,
					menuItemId: menuItemId.data,
				}),
			},
			201,
		);
	});

	input.app.patch("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningOpsReviewUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价修改请求无效。", 400);
		}
		return context.json({
			review: await input.diningReviewStore.updateReview(
				toDiningActor(operator),
				reviewId,
				body.data.body,
			),
		});
	});

	input.app.put("/api/ops/dining/reviews/:reviewId/visibility", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningOpsReviewVisibilitySchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价可见性请求无效。", 400);
		}
		return context.json({
			review: await input.diningReviewStore.setReviewVisibility(
				toDiningActor(operator),
				reviewId,
				body.data.visible,
			),
		});
	});

	input.app.delete("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		if (!OpsPathIdSchema.safeParse(reviewId).success) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价标识无效。", 400);
		}
		await input.diningReviewStore.deleteOperatorReview(toDiningActor(operator), reviewId);
		return new Response(null, { status: 204 });
	});

	input.app.get("/api/ops/dining/reports", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningReportListQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_DINING_QUERY_INVALID", "举报查询参数无效。", 400);
		}
		return context.json(
			await input.diningReviewStore.listReports({
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				limit: query.data.limit,
				status: query.data.status,
			}),
		);
	});

	input.app.post("/api/ops/dining/reviews/:reviewId/reports/resolve", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningReportResolutionSchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REPORT_INVALID", "举报处理请求无效。", 400);
		}
		await input.diningReviewStore.resolveReports(
			toDiningActor(operator),
			reviewId,
			body.data.resolution,
		);
		return new Response(null, { status: 204 });
	});
}

async function admitDiningWrite(
	admission: OpsAdmission,
	request: Request,
	publicOrigin: string | null,
): Promise<OpsOperatorContext | Response> {
	const operator = await admitOpsApiRequest(admission, request);
	if (operator instanceof Response) {
		return operator;
	}
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_DINING_ORIGIN_INVALID", "食堂修改请求来源无效。", 403);
	}
	return operator;
}

function toDiningActor(operator: OpsOperatorContext) {
	return {
		displayName: operator.displayName ?? operator.email ?? operator.operatorId,
		principalId: operator.operatorId,
	};
}
