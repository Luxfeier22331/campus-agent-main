import { Hono } from "hono";
import type { Pool } from "pg";
import { beforeEach, expect, it, vi } from "vitest";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createProviderConfigAdminClient } from "../src/server/provider-config-client.ts";

const launchOcrJob = vi.hoisted(() => vi.fn());
vi.mock("../src/server/ocr-jobs.ts", () => ({ launchOcrJob }));
const runtime = {
	schema_version: "model_runtime_config.v1",
	name: "document_ocr",
	provider: "paddleocr",
	api_protocol: "paddleocr.jobs",
	model: "PaddleOCR-VL-1.6",
	base_url: "https://paddle.example",
	api_key: "test-only",
	updated_at: "2026-01-01T00:00:00.123456Z",
};
async function app() {
	const { registerOcrRoutes } = await import("../src/server/routes/ocr.ts");
	const instance = new Hono();
	const query = vi.fn().mockImplementation(async (_sql: string, values: unknown[]) => ({
		rows: [{ id: values[0], input: values[2], status: "pending" }],
	}));
	registerOcrRoutes({
		app: instance,
		admission: createAllowAllOpsAdmission(),
		publicOrigin: "http://ops.test",
		pool: { query } as unknown as Pool,
		env: { MODEL_CONFIG_URL: "http://model-config.test" },
		providerConfigClient: createProviderConfigAdminClient({
			MODEL_CONFIG_URL: "http://model-config.test",
		}),
	});
	return { instance, query };
}
beforeEach(() => {
	vi.resetModules();
	launchOcrJob.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(runtime)));
});
it("returns 202 and a persisted task before OCR completes", async () => {
	const { instance, query } = await app();
	const response = await instance.request(
		"http://ops.test/api/ops/model-configs/document_ocr/validate",
		{ method: "POST", headers: { origin: "http://ops.test" } },
	);
	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({ task: { status: "pending" }, launchError: null });
	expect(query).toHaveBeenCalledTimes(1);
	expect(launchOcrJob).toHaveBeenCalledTimes(1);
});
it("keeps a queued task visible when the cluster launcher is unavailable", async () => {
	vi.mocked(launchOcrJob).mockRejectedValueOnce(new Error("template unavailable"));
	const { instance } = await app();
	const response = await instance.request(
		"http://ops.test/api/ops/model-configs/document_ocr/validate",
		{ method: "POST", headers: { origin: "http://ops.test" } },
	);
	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({
		task: { status: "pending" },
		launchError: "template unavailable",
	});
});
it("rejects cross-origin OCR writes before creating a task", async () => {
	const { instance, query } = await app();
	const response = await instance.request(
		"http://ops.test/api/ops/model-configs/document_ocr/validate",
		{ method: "POST", headers: { origin: "https://other.test" } },
	);
	expect(response.status).toBe(403);
	expect(query).not.toHaveBeenCalled();
});
it("rejects malformed task ids before querying PostgreSQL", async () => {
	const { instance, query } = await app();
	const response = await instance.request("http://ops.test/api/ops/ocr/tasks/not-a-uuid");
	expect(response.status).toBe(400);
	expect(query).not.toHaveBeenCalled();
});
