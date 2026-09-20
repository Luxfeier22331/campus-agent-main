import { Hono } from "hono";
import { TaskIdSchema, TaskScheduleInputSchema } from "../../shared/tasks-contract.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { type createTaskService, TaskError } from "../tasks.ts";
import { admitOpsApiRequest, isJsonContentType, jsonError, readBoundedJson } from "./http.ts";
export function registerTaskRoutes(input: {
	app: Hono;
	admission: OpsAdmission;
	service: ReturnType<typeof createTaskService>;
}) {
	const app = new Hono();
	app.onError((error) =>
		jsonError("OPS_TASK_FAILED", error.message, error instanceof TaskError ? error.status : 503),
	);
	app.use("*", async (c, next) => {
		const admitted = await admitOpsApiRequest(input.admission, c.req.raw);
		if (admitted instanceof Response) {
			return admitted;
		}
		await next();
		return;
	});
	app.post("/campus-rag-refresh/rollback", async (c) =>
		c.json(await input.service.rollback(), 202),
	);
	app.get("/", async (c) => c.json({ tasks: await input.service.list() }));
	app.put("/:taskId/schedule", async (c) => {
		const id = TaskIdSchema.safeParse(c.req.param("taskId"));
		if (!id.success) {
			return jsonError("OPS_TASK_NOT_FOUND", "任务不存在", 404);
		}
		if (!isJsonContentType(c.req.header("content-type"))) {
			return jsonError("OPS_TASK_INVALID", "请求必须为 JSON", 400);
		}
		const value = TaskScheduleInputSchema.safeParse(await readBoundedJson(c.req.raw, 4096));
		if (!value.success) {
			return jsonError("OPS_TASK_INVALID", "请选择启停状态与 15、30 或 60 分钟周期", 400);
		}
		await input.service.update(id.data, value.data);
		return c.json({ updated: true });
	});
	app.post("/:taskId/runs", async (c) => {
		const id = TaskIdSchema.safeParse(c.req.param("taskId"));
		if (!id.success) {
			return jsonError("OPS_TASK_NOT_FOUND", "任务不存在", 404);
		}
		return c.json({ result: (await input.service.run(id.data)) ?? null }, 202);
	});
	app.get("/:taskId/runs", async (c) => {
		const id = TaskIdSchema.safeParse(c.req.param("taskId"));
		if (!id.success) {
			return jsonError("OPS_TASK_NOT_FOUND", "任务不存在", 404);
		}
		return c.json({ runs: await input.service.runs(id.data) });
	});
	app.get("/:taskId/runs/:runId", async (c) => {
		const id = TaskIdSchema.safeParse(c.req.param("taskId"));
		if (!id.success) {
			return jsonError("OPS_TASK_NOT_FOUND", "任务不存在", 404);
		}
		const run = await input.service.getRun(id.data, c.req.param("runId"));
		return run
			? c.json(run)
			: jsonError("OPS_TASK_RUN_NOT_FOUND", "运行记录不存在或已过保留期", 404);
	});
	input.app.route("/api/ops/tasks", app);
}
