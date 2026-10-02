import { Hono } from "hono";
import type { Pool } from "pg";
import { beforeEach, expect, it, vi } from "vitest";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createProviderConfigAdminClient } from "../src/server/provider-config-client.ts";

const launchOcrJob = vi.hoisted(() => vi.fn());
vi.mock("../src/server/ocr-jobs.ts", () => ({ launchOcrJob }));
const getSource = vi.hoisted(() => vi.fn());
vi.mock("@campus-agent/document-ocr", async (importOriginal) => ({
	...(await importOriginal<typeof import("@campus-agent/document-ocr")>()),
	createOcrObjects: () => ({ getSource, close: vi.fn() }),
}));
const noticeSource = {
	notice_id: 123,
	is_external: false,
	notice_content_html:
		'<img src="/static/index/UEditor/themes/default/images/spacer.gif"><img src="/a.png"><img src="/b.jpg">',
	attachments: [{ suffix: "pdf" }],
};
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
	getSource.mockReset().mockResolvedValue(new TextEncoder().encode(JSON.stringify(noticeSource)));
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

it("lists only body images with display ordinals independent of source keys", async () => {
	const { instance, query } = await app();
	query
		.mockResolvedValueOnce({ rows: [{ notice_id: 123 }] })
		.mockResolvedValueOnce({ rows: [{ source_ref: null }] })
		.mockResolvedValueOnce({ rows: [] });
	const response = await instance.request("http://ops.test/api/ops/ocr/notices/123");
	expect(response.status).toBe(200);
	const data = await response.json();
	expect(data.resources).toHaveLength(2);
	expect(data.resources[0]).toMatchObject({
		kind: "image",
		ordinal: 1,
		displayOrdinal: 0,
		label: "图片1",
		sourceKey: "internal_portal/notices/123/images/1",
	});
	expect(data.resources[1]).toMatchObject({ ordinal: 2, displayOrdinal: 1 });
});
it("queues only the requested display image and excludes attachments", async () => {
	const { instance, query } = await app();
	const response = await instance.request("http://ops.test/api/ops/ocr/tasks", {
		method: "POST",
		headers: { origin: "http://ops.test", "content-type": "application/json" },
		body: JSON.stringify({ noticeId: "123", imageOrdinal: 1 }),
	});
	expect(response.status).toBe(202);
	expect(query).toHaveBeenCalledTimes(2);
	expect(query.mock.calls[1]?.[1]?.[2]).toMatchObject({
		key: "internal_portal/notices/123/images/2",
		resource: { kind: "image", ordinal: 2, displayOrdinal: 1 },
	});
});
it("does not create a task for a nonexistent body image", async () => {
	const { instance, query } = await app();
	const response = await instance.request("http://ops.test/api/ops/ocr/tasks", {
		method: "POST",
		headers: { origin: "http://ops.test", "content-type": "application/json" },
		body: JSON.stringify({ noticeId: "123", imageOrdinal: 2 }),
	});
	expect(response.status).toBe(404);
	expect(query.mock.calls.some(([sql]) => sql.includes("insert into ocr.tasks"))).toBe(false);
	expect(launchOcrJob).not.toHaveBeenCalled();
});
it("does not create tasks for external notices", async () => {
	getSource.mockResolvedValue(
		new TextEncoder().encode(JSON.stringify({ ...noticeSource, is_external: true })),
	);
	const { instance, query } = await app();
	const response = await instance.request("http://ops.test/api/ops/ocr/tasks", {
		method: "POST",
		headers: { origin: "http://ops.test", "content-type": "application/json" },
		body: JSON.stringify({ noticeId: "123" }),
	});
	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({ tasks: [] });
	expect(query.mock.calls.some(([sql]) => sql.includes("insert into ocr.tasks"))).toBe(false);
	expect(launchOcrJob).not.toHaveBeenCalled();
});

it("queues the requested body image from the current source snapshot", async () => {
	const sourceKey = `internal_portal/notices/123/sources/${"a".repeat(64)}.json`;
	const imageKey = `internal_portal/resources/sha256/${"b".repeat(64)}`;
	const { instance, query } = await app();
	query.mockResolvedValueOnce({ rows: [{ source_ref: sourceKey }] });
	getSource.mockResolvedValue(
		new TextEncoder().encode(
			JSON.stringify({
				...noticeSource,
				resources: [
					{ kind: "images", ordinal: 1, object_key: imageKey },
					{
						kind: "images",
						ordinal: 2,
						object_key: `internal_portal/resources/sha256/${"c".repeat(64)}`,
					},
				],
			}),
		),
	);
	const response = await instance.request("http://ops.test/api/ops/ocr/tasks", {
		method: "POST",
		headers: { origin: "http://ops.test", "content-type": "application/json" },
		body: JSON.stringify({ noticeId: "123", imageOrdinal: 0 }),
	});
	expect(response.status).toBe(202);
	expect(getSource).toHaveBeenCalledWith(sourceKey);
	expect(query.mock.calls[1]?.[1]?.[2]).toMatchObject({
		noticeId: "123",
		key: imageKey,
		resource: { kind: "image", ordinal: 1, displayOrdinal: 0 },
	});
	expect(query.mock.calls[1]?.[1]?.[1]).toBe(`source:123:${imageKey}`);
});
