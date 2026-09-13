import type { Hono } from "hono";
import {
	NoticeAutomationInputSchema,
	NoticeAutomationSchema,
} from "../../shared/notice-automation-contract.ts";
import { NoticeAutomationError, type NoticeAutomationService } from "../notice-automation.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, isJsonContentType, jsonError, readBoundedJson } from "./http.ts";

export function registerNoticeAutomationRoutes(input: {
	app: Hono;
	admission: OpsAdmission;
	service: NoticeAutomationService;
}) {
	input.app.get("/api/ops/notices/automation", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(NoticeAutomationSchema.parse(await input.service.get()));
	});
	input.app.put("/api/ops/notices/automation", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError("OPS_NOTICE_AUTOMATION_INVALID", "请求必须为 JSON。", 400);
		}
		const parsed = NoticeAutomationInputSchema.safeParse(
			await readBoundedJson(context.req.raw, 4096),
		);
		if (!parsed.success) {
			return jsonError(
				"OPS_NOTICE_AUTOMATION_INVALID",
				"请选择采集开关及 15、30 或 60 分钟频率。",
				400,
			);
		}
		try {
			return context.json(NoticeAutomationSchema.parse(await input.service.update(parsed.data)));
		} catch (error) {
			if (error instanceof NoticeAutomationError) {
				return jsonError("OPS_NOTICE_AUTOMATION_FAILED", error.message, error.status);
			}
			throw error;
		}
	});
}
