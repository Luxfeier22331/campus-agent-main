import type { Hono } from "hono";
import {
	NoticePipelineJobCreateSchema,
	NoticePipelineJobListResponseSchema,
	NoticePipelineJobResponseSchema,
} from "../../shared/ops-contract.ts";
import {
	NoticePipelineJobNotFoundError,
	type NoticePipelineJobService,
} from "../notice-pipeline-jobs.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, isJsonContentType, jsonError, readBoundedJson } from "./http.ts";

export function registerNoticePipelineRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	service: NoticePipelineJobService;
}): void {
	input.app.get("/api/ops/notice-pipeline/jobs", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(
			NoticePipelineJobListResponseSchema.parse({ jobs: await input.service.list() }),
		);
	});

	input.app.get("/api/ops/notice-pipeline/jobs/:jobName", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const jobName = context.req.param("jobName");
		if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(jobName)) {
			return jsonError("OPS_NOTICE_JOB_INPUT_INVALID", "通知任务名称无效。", 400);
		}
		const job = await input.service.get(jobName);
		if (!job) {
			throw new NoticePipelineJobNotFoundError();
		}
		return context.json(NoticePipelineJobResponseSchema.parse({ job }));
	});

	input.app.post("/api/ops/notice-pipeline/jobs", async (context) => {
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
		const body = NoticePipelineJobCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_NOTICE_JOB_INPUT_INVALID", "通知任务参数无效。", 400);
		}
		return context.json(
			NoticePipelineJobResponseSchema.parse({ job: await input.service.create(body.data) }),
			201,
		);
	});
}
