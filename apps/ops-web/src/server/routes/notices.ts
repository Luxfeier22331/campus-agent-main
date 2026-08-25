import type { Hono } from "hono";
import { z } from "zod";
import {
	NoticeCategorySchema,
	NoticeCategoryUpdateSchema,
	NoticeDetailResponseSchema,
	NoticeJobCreateSchema,
	NoticeJobListResponseSchema,
	NoticeJobResponseSchema,
	NoticeListResponseSchema,
	NoticeStateSchema,
} from "../../shared/ops-contract.ts";
import { NoticeJobNotFoundError, type NoticeJobService } from "../notice-jobs.ts";
import type { NoticeStore } from "../notice-store.ts";
import { NoticeNotFoundError } from "../notice-store.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, isJsonContentType, jsonError, readBoundedJson } from "./http.ts";

const NoticeListQuerySchema = z
	.object({
		category: NoticeCategorySchema.optional(),
		page: z.coerce.number().int().positive().default(1),
		q: z.string().trim().min(1).max(200).optional(),
		state: NoticeStateSchema.optional(),
	})
	.strict();

export function registerNoticeRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	jobService: NoticeJobService;
	store: NoticeStore;
}): void {
	registerJobRoutes(input);

	input.app.get("/api/ops/notices", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = NoticeListQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_NOTICE_QUERY_INVALID", "通知筛选参数无效。", 400);
		}
		return context.json(
			NoticeListResponseSchema.parse(
				await input.store.list({
					...(query.data.category ? { category: query.data.category } : {}),
					page: query.data.page,
					...(query.data.q ? { q: query.data.q } : {}),
					...(query.data.state ? { state: query.data.state } : {}),
				}),
			),
		);
	});

	input.app.get("/api/ops/notices/:noticeId", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const noticeId = parseNoticeId(context.req.param("noticeId"));
		if (noticeId === null) {
			return jsonError("OPS_NOTICE_ID_INVALID", "通知 ID 无效。", 400);
		}
		const notice = await input.store.get(noticeId);
		if (!notice) {
			throw new NoticeNotFoundError();
		}
		return context.json(NoticeDetailResponseSchema.parse({ notice }));
	});

	input.app.put("/api/ops/notices/:noticeId/category", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const noticeId = parseNoticeId(context.req.param("noticeId"));
		if (noticeId === null) {
			return jsonError("OPS_NOTICE_ID_INVALID", "通知 ID 无效。", 400);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_NOTICE_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = NoticeCategoryUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_NOTICE_CATEGORY_INVALID", "通知分类无效。", 400);
		}
		return context.json(
			NoticeDetailResponseSchema.parse({
				notice: await input.store.updateCategory(noticeId, body.data.category),
			}),
		);
	});
}

function registerJobRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	jobService: NoticeJobService;
}): void {
	input.app.get("/api/ops/notices/jobs", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(NoticeJobListResponseSchema.parse({ jobs: await input.jobService.list() }));
	});

	input.app.get("/api/ops/notices/jobs/:jobName", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const jobName = context.req.param("jobName");
		if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(jobName)) {
			return jsonError("OPS_NOTICE_JOB_INPUT_INVALID", "通知任务名称无效。", 400);
		}
		const job = await input.jobService.get(jobName);
		if (!job) {
			throw new NoticeJobNotFoundError();
		}
		return context.json(NoticeJobResponseSchema.parse({ job }));
	});

	input.app.post("/api/ops/notices/jobs", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_NOTICE_JOB_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = NoticeJobCreateSchema.safeParse(await readBoundedJson(context.req.raw, 8 * 1024));
		if (!body.success) {
			return jsonError("OPS_NOTICE_JOB_INPUT_INVALID", "通知任务参数无效。", 400);
		}
		return context.json(
			NoticeJobResponseSchema.parse({ job: await input.jobService.create(body.data) }),
			201,
		);
	});
}

function parseNoticeId(value: string): number | null {
	return /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
