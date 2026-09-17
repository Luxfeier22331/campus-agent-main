import {
	DiningOpsSubmissionReportResolutionSchema,
	DiningOpsSubmissionRevisionSchema,
	DiningOpsSubmissionVisibilitySchema,
} from "@campus-agent/dining/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { DiningSubmissionStore } from "../dining-submission-store-contract.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	jsonError,
	OpsPathIdSchema,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

const querySchema = z
	.object({
		cursor: z.string().min(1).max(2048).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		window_id: OpsPathIdSchema.optional(),
		status: z.enum(["public", "hidden", "deleted", "expired", "purged"]).optional(),
		report_status: z.enum(["pending", "resolved"]).optional(),
	})
	.strict();

export function registerDiningSubmissionRoutes(input: {
	app: Hono;
	admission: OpsAdmission;
	store: DiningSubmissionStore;
	publicOrigin: string | null;
}): void {
	input.app.use("/api/ops/dining/submissions", async (context, next) => {
		context.header("Cache-Control", "no-store");
		await next();
	});
	input.app.use("/api/ops/dining/submissions/*", async (context, next) => {
		context.header("Cache-Control", "no-store");
		await next();
	});
	input.app.get("/api/ops/dining/submissions", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = querySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_DINING_QUERY_INVALID", "投稿查询参数无效。", 400);
		}
		return context.json(
			await input.store.listSubmissions({
				limit: query.data.limit,
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				...(query.data.window_id ? { windowId: query.data.window_id } : {}),
				...(query.data.status ? { status: query.data.status } : {}),
				...(query.data.report_status ? { reportStatus: query.data.report_status } : {}),
			}),
		);
	});
	input.app.get("/api/ops/dining/submissions/:submissionId", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const id = OpsPathIdSchema.safeParse(context.req.param("submissionId"));
		if (!id.success || Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "投稿查询参数无效。", 400);
		}
		return context.json(await input.store.getSubmission(id.data));
	});
	input.app.get("/api/ops/dining/submissions/:submissionId/photos/:photoId", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const id = OpsPathIdSchema.safeParse(context.req.param("submissionId"));
		const photo = OpsPathIdSchema.safeParse(context.req.param("photoId"));
		if (!(id.success && photo.success) || Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "投稿图片查询参数无效。", 400);
		}
		const result = await input.store.getPhoto(
			id.data,
			photo.data,
			context.req.raw.headers.get("if-none-match"),
		);
		// Photo successes keep a revalidation cache policy; Hono 4.13 does not merge
		// the boundary's no-store middleware into handler-returned responses.
		if (result.notModified) {
			return new Response(null, {
				headers: { "Cache-Control": "private, no-cache", ETag: result.etag },
				status: 304,
			});
		}
		return new Response(new Uint8Array(result.bytes), {
			headers: {
				"Cache-Control": "private, no-cache",
				"Content-Type": "image/webp",
				ETag: result.etag,
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
	for (const action of ["visibility", "delete", "restore", "reports/resolve"] as const) {
		input.app.on(
			action === "visibility" ? "PUT" : "POST",
			`/api/ops/dining/submissions/:submissionId/${action}`,
			async (context) => {
				const operator = await admitOpsApiRequest(input.admission, context.req.raw);
				if (operator instanceof Response) {
					return operator;
				}
				if (!requestHasConfiguredOrigin(context.req.raw, input.publicOrigin)) {
					return jsonError("OPS_DINING_ORIGIN_INVALID", "食堂修改请求来源无效。", 403);
				}
				const id = OpsPathIdSchema.safeParse(context.req.param("submissionId"));
				const body = await readBoundedJson(context.req.raw, 4096);
				const parsed = (
					action === "visibility"
						? DiningOpsSubmissionVisibilitySchema
						: action === "reports/resolve"
							? DiningOpsSubmissionReportResolutionSchema
							: DiningOpsSubmissionRevisionSchema
				).safeParse(body);
				if (!(id.success && parsed.success)) {
					return jsonError("OPS_DINING_SUBMISSION_INVALID", "投稿治理请求无效。", 400);
				}
				const actor = {
					principalId: operator.operatorId,
					displayName: operator.displayName ?? operator.email ?? operator.operatorId,
				};
				if (action === "reports/resolve") {
					await input.store.resolveReports(
						actor,
						id.data,
						parsed.data.expectedRevision,
						DiningOpsSubmissionReportResolutionSchema.parse(body).resolution,
					);
					return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
				}
				const submission =
					action === "visibility"
						? await input.store.setVisibility(
								actor,
								id.data,
								parsed.data.expectedRevision,
								DiningOpsSubmissionVisibilitySchema.parse(body).visible,
							)
						: action === "delete"
							? await input.store.deleteSubmission(actor, id.data, parsed.data.expectedRevision)
							: await input.store.restoreSubmission(actor, id.data, parsed.data.expectedRevision);
				return context.json({ submission });
			},
		);
	}
}
