// @vitest-environment node
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { registerTaskRoutes } from "../src/server/routes/tasks";
import { TaskError } from "../src/server/tasks";

function fixture(denied = false) {
	const app = new Hono();
	const service = {
		list: vi.fn(async () => []),
		runs: vi.fn(async () => []),
		getRun: vi.fn(async () => null),
		update: vi.fn(async () => undefined),
		run: vi.fn(async () => ({ workflowId: "refresh", runId: "run-1" })),
		rollback: vi.fn(async () => ({ workflowId: "rollback", runId: "run-1" })),
	};
	registerTaskRoutes({
		app,
		service,
		admission: denied
			? { admit: async () => ({ operator: null, response: new Response(null, { status: 401 }) }) }
			: createAllowAllOpsAdmission(),
	});
	return { app, service };
}
describe("fixed tasks API", () => {
	it("looks up a specific run without reading the recent-run list", async () => {
		const { app, service } = fixture();
		expect((await app.request("/api/ops/tasks/notice-pipeline/runs/old-run")).status).toBe(404);
		expect(service.getRun).toHaveBeenCalledWith("notice-pipeline", "old-run");
		expect(service.runs).not.toHaveBeenCalled();
	});
	it("admits before reading or mutating runtime state", async () => {
		const { app, service } = fixture(true);
		for (const [url, method] of [
			["/api/ops/tasks", "GET"],
			["/api/ops/tasks/notice-sync/schedule", "PUT"],
			["/api/ops/tasks/notice-sync/runs", "POST"],
		] as const) {
			expect((await app.request(url, { method })).status).toBe(401);
		}
		expect(service.list).not.toHaveBeenCalled();
		expect(service.update).not.toHaveBeenCalled();
	});
	it("rejects arbitrary commands and unsupported intervals", async () => {
		const { app, service } = fixture();
		for (const value of [
			{ enabled: true, intervalMinutes: 5 },
			{ enabled: true, intervalMinutes: 15, command: "other" },
		]) {
			expect(
				(
					await app.request("/api/ops/tasks/notice-classifier/schedule", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(value),
					})
				).status,
			).toBe(400);
		}
		expect(service.update).not.toHaveBeenCalled();
		expect((await app.request("/api/ops/tasks/arbitrary/runs", { method: "POST" })).status).toBe(
			404,
		);
	});
	it("preserves native busy conflicts", async () => {
		const { app, service } = fixture();
		service.run.mockRejectedValue(new TaskError("already running", 409));
		expect(
			(await app.request("/api/ops/tasks/notice-publisher/runs", { method: "POST" })).status,
		).toBe(409);
	});
	it("passes only the fixed schedule contract", async () => {
		const { app, service } = fixture();
		const body = { enabled: false, intervalMinutes: 30 };
		expect(
			(
				await app.request("/api/ops/tasks/notice-classifier/schedule", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				})
			).status,
		).toBe(200);
		expect(service.update).toHaveBeenCalledWith("notice-classifier", body);
	});
});
