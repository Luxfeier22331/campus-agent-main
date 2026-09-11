import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPaddleClient,
	OCR_MODEL,
	OCR_OPTIONS,
	type OcrConfig,
	type OcrObjects,
	type OcrTask,
	type OcrTaskStore,
	parseResult,
	persistResult,
	runOcrTask,
	timeoutFetch,
	validationDocument,
} from "../src/index.ts";

const config: OcrConfig = {
	baseUrl: "https://paddle.example",
	apiKey: "test-only",
	updatedAt: "2026-01-01T00:00:00.000Z",
	model: OCR_MODEL,
	options: OCR_OPTIONS,
};
function fixture() {
	const task: OcrTask = {
		id: "task-1",
		input: { kind: "validation" },
		inputSha256: null,
		target: config,
		configUpdatedAt: config.updatedAt,
		status: "pending",
		providerJobId: null,
		progress: null,
		error: null,
		result: null,
		createdAt: config.updatedAt,
		updatedAt: config.updatedAt,
	};
	const stored = new Map<string, Uint8Array>();
	const objects: OcrObjects = {
		getSource: vi.fn(),
		async getDerived(key) {
			const bytes = stored.get(key);
			if (!bytes) {
				throw new Error("not found");
			}
			return bytes;
		},
		async putDerived(key, bytes) {
			stored.set(key, bytes);
		},
		close() {
			/* In-memory fixture has no connections. */
		},
	};
	const store: OcrTaskStore = {
		save: vi.fn(),
		get: vi.fn(),
		list: vi.fn(),
		listNotice: vi.fn(),
		create: vi.fn(),
		runnable: vi.fn(),
	};
	const client = {
		submitDocumentParsing: vi.fn().mockResolvedValue({ jobId: "provider-1" }),
		getStatus: vi
			.fn()
			.mockResolvedValue({ state: "done", resultUrl: { jsonUrl: "https://result.example/out" } }),
	} as unknown as ReturnType<typeof createPaddleClient>;
	const download = vi.fn().mockResolvedValue(raw("CAMPUS OCR 12345"));
	return { task, objects, store, config, client, download, pollMs: 1 };
}
function raw(text: string, images = {}) {
	return new TextEncoder().encode(
		JSON.stringify({
			errorCode: 0,
			result: { layoutParsingResults: [{ markdown: { text, images } }] },
		}),
	);
}
afterEach(() => vi.restoreAllMocks());
describe("Paddle document parsing", () => {
	it("uses official SDK multipart submission, model and options", async () => {
		const directory = await mkdtemp(join(tmpdir(), "ocr-sdk-test-"));
		try {
			const path = join(directory, "test.pdf");
			await writeFile(path, validationDocument());
			const wire = vi
				.fn<typeof fetch>()
				.mockResolvedValue(Response.json({ data: { jobId: "sdk-1" } }));
			const client = createPaddleClient(config, config, wire);
			expect(
				await client.submitDocumentParsing({
					filePath: path,
					model: OCR_MODEL,
					options: OCR_OPTIONS,
				}),
			).toMatchObject({ jobId: "sdk-1" });
			expect(String(wire.mock.calls[0]?.[0])).toBe("https://paddle.example/api/v2/ocr/jobs");
			const request = wire.mock.calls[0]?.[1];
			if (!request) {
				throw new Error("SDK did not send a request");
			}
			expect(new Headers(request.headers).get("authorization")).toMatch(/bearer test-only/i);
			const body = request.body as FormData;
			expect(body.get("model")).toBe(OCR_MODEL);
			expect(JSON.parse(String(body.get("optionalPayload")))).toEqual(OCR_OPTIONS);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("does not send a rotated token to a changed endpoint", () => {
		expect(() => createPaddleClient(config, { ...config, baseUrl: "https://old.example" })).toThrow(
			/endpoint changed/,
		);
	});
	it("bounds response body consumption, not only headers", async () => {
		const server = createServer((_req, res) => {
			res.writeHead(200);
			res.write("{");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address() as { port: number };
			const response = await timeoutFetch(80)(`http://127.0.0.1:${address.port}`);
			await expect(response.text()).rejects.toThrow();
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
	it("preserves HTML tables and JSONL page order", () => {
		const first = '<table><tr><td rowspan="2" colspan="3">07:00</td></tr></table>';
		const pages = parseResult(
			`${new TextDecoder().decode(raw(first))}\n${new TextDecoder().decode(raw("second"))}`,
		);
		expect(pages.map((p) => p.text)).toEqual([first, "second"]);
	});
	it("rejects error records and empty results", () => {
		expect(() => parseResult('{"errorCode":1,"result":{}}')).toThrow();
		expect(() => parseResult("")).toThrow();
	});
	it("stores only markdown assets and rewrites their paths", async () => {
		const f = fixture();
		const result = await persistResult(
			"task-1",
			raw("![x](unsafe/../../a.jpg)", { "unsafe/../../a.jpg": "https://asset.example/a" }),
			f.objects,
			{ download: async () => new Uint8Array([1]) },
		);
		expect(result.pages[0]?.images).toEqual(["ocr/tasks/task-1/images/0-0"]);
		expect(
			new TextDecoder().decode(await f.objects.getDerived(result.pages[0]?.markdownKey ?? "")),
		).toBe("![x](images/0-0)");
	});
	it("persists provider id before polling and completes after storing results", async () => {
		const f = fixture();
		const snapshots: OcrTask[] = [];
		f.store.save = async (task) => {
			snapshots.push(structuredClone(task));
		};
		const reportValidation = vi.fn();
		await runOcrTask(f.task, { ...f, reportValidation });
		expect(snapshots.map((t) => t.status)).toEqual([
			"submitting",
			"submitted",
			"submitted",
			"submitted",
			"completed",
		]);
		expect(snapshots[1]?.providerJobId).toBe("provider-1");
		expect(f.task.result?.pages).toHaveLength(1);
		expect(reportValidation).toHaveBeenCalledWith(config.updatedAt, true, expect.any(String));
	});
	it("never resubmits an interrupted submission without a job id", async () => {
		const f = fixture();
		f.task.status = "submitting";
		await runOcrTask(f.task, f);
		expect(f.task.status).toBe("failed");
		expect(f.client.submitDocumentParsing).not.toHaveBeenCalled();
	});
	it("resumes stored job after result download failure without submitting again", async () => {
		const f = fixture();
		f.download.mockRejectedValueOnce(new Error("download failed"));
		await runOcrTask(f.task, f);
		expect(f.task.status).toBe("submitted");
		await runOcrTask(f.task, f);
		expect(f.task.status).toBe("completed");
		expect(f.client.submitDocumentParsing).toHaveBeenCalledTimes(1);
	});
	it("keeps a running job for the next run when the wait window expires", async () => {
		const f = fixture();
		vi.mocked(f.client.getStatus).mockResolvedValue({ jobId: "provider-1", state: "running" });
		await runOcrTask(f.task, { ...f, waitMs: 30 });
		expect(f.task.status).toBe("submitted");
		expect(f.task.providerJobId).toBe("provider-1");
	});
	it("recovers validation reporting from owned results without contacting the provider", async () => {
		const f = fixture();
		const reportValidation = vi.fn().mockRejectedValueOnce(new Error("callback unavailable"));
		await runOcrTask(f.task, { ...f, reportValidation });
		expect(f.task.status).toBe("submitted");
		expect(f.task.result?.pages).toHaveLength(1);
		vi.mocked(f.client.getStatus).mockRejectedValue(new Error("provider job expired"));
		await runOcrTask(f.task, { ...f, reportValidation });
		expect(f.task.status).toBe("completed");
		expect(reportValidation).toHaveBeenCalledTimes(2);
		expect(f.client.getStatus).toHaveBeenCalledTimes(1);
		expect(f.download).toHaveBeenCalledTimes(1);
		expect(f.client.submitDocumentParsing).toHaveBeenCalledTimes(1);
	});
	it("finishes from persisted JSONL after interruption without querying the provider", async () => {
		const f = fixture();
		f.task.status = "submitted";
		f.task.providerJobId = "provider-1";
		await f.objects.putDerived(
			`ocr/tasks/${f.task.id}/result.jsonl`,
			raw("CAMPUS OCR 12345"),
			"application/x-ndjson",
		);
		await runOcrTask(f.task, f);
		expect(f.task.status).toBe("completed");
		expect(f.client.getStatus).not.toHaveBeenCalled();
		expect(f.client.submitDocumentParsing).not.toHaveBeenCalled();
	});
	it("treats malformed provider JSONL as a terminal failure", async () => {
		const f = fixture();
		f.download.mockResolvedValue(new TextEncoder().encode("not JSONL"));
		await runOcrTask(f.task, f);
		expect(f.task.status).toBe("failed");
		expect(f.task.error).toMatch(/not valid JSONL/);
		await runOcrTask(f.task, f);
		expect(f.client.getStatus).toHaveBeenCalledTimes(1);
	});
	it("does not report submission alone as validated", async () => {
		const f = fixture();
		const reportValidation = vi.fn();
		vi.mocked(f.client.getStatus).mockResolvedValue({ jobId: "provider-1", state: "pending" });
		await runOcrTask(f.task, { ...f, waitMs: 30, reportValidation });
		expect(reportValidation).not.toHaveBeenCalled();
	});
	it("reports provider failure without automatically rerunning", async () => {
		const f = fixture();
		const reportValidation = vi.fn();
		vi.mocked(f.client.getStatus).mockResolvedValue({
			jobId: "provider-1",
			state: "failed",
			errorMsg: "quota",
		});
		await runOcrTask(f.task, { ...f, reportValidation });
		expect(f.task.status).toBe("failed");
		expect(reportValidation).toHaveBeenCalledWith(config.updatedAt, false, "quota");
	});
	it("does not drop imported text when an old image URL expired", async () => {
		const f = fixture();
		const result = await persistResult(
			f.task.id,
			raw("![x](a.jpg)", { "a.jpg": "https://expired.example" }),
			f.objects,
			{
				allowMissingImages: true,
				download: async () => {
					throw new Error("expired");
				},
			},
		);
		expect(result.pages).toHaveLength(1);
		expect(result.missingImages).toEqual(["a.jpg"]);
	});
});
