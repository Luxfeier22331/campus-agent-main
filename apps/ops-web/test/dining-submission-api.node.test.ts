// @vitest-environment node
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
	createDiningSubmissionAssetStoreFromEnv,
	createS3DiningSubmissionAssetStore,
} from "../src/server/dining-submission-assets";
import { createUnavailableDiningSubmissionStore } from "../src/server/dining-submission-store";
import type { DiningSubmissionStore } from "../src/server/dining-submission-store-contract";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createTestOpsApp } from "./helpers/ops-app";

function fixture(overrides: Partial<DiningSubmissionStore> = {}) {
	const store = {
		...createUnavailableDiningSubmissionStore(new Error("unconfigured")),
		...overrides,
	};
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		diningSubmissionStore: store,
		env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
	});
	return { app, store };
}

describe("Ops submission HTTP boundary", () => {
	it("uses the existing admission for photo and content reads", async () => {
		const getPhoto = vi.fn();
		const app = createTestOpsApp({
			diningSubmissionStore: { ...createUnavailableDiningSubmissionStore(null), getPhoto },
		});
		const response = await app.request("/api/ops/dining/submissions/submission-1/photos/photo-1");
		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(getPhoto).not.toHaveBeenCalled();
	});
	it("forwards strict list filters and never caches errors", async () => {
		const listSubmissions = vi.fn(async () => ({ items: [], nextCursor: null }));
		const { app } = fixture({ listSubmissions });
		const response = await app.request(
			"/api/ops/dining/submissions?status=hidden&report_status=pending&window_id=hall:floor:w1",
		);
		expect(response.status).toBe(200);
		expect(listSubmissions).toHaveBeenCalledWith({
			limit: 50,
			status: "hidden",
			reportStatus: "pending",
			windowId: "hall:floor:w1",
		});
		const invalid = await app.request("/api/ops/dining/submissions?author_id=another-user");
		expect(invalid.status).toBe(400);
		expect(invalid.headers.get("cache-control")).toBe("no-store");
	});
	it("requires configured Origin and versioned mutation bodies", async () => {
		const resolveReports = vi.fn(async () => undefined);
		const { app } = fixture({ resolveReports });
		const path = "/api/ops/dining/submissions/submission-1/reports/resolve";
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ expectedRevision: 3, resolution: "keep" }),
				})
			).status,
		).toBe(403);
		const headers = { "content-type": "application/json", origin: "https://ops.example.test" };
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers,
					body: JSON.stringify({ resolution: "keep" }),
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers,
					body: JSON.stringify({ expectedRevision: 3, resolution: "keep", name: "不得改正文" }),
				})
			).status,
		).toBe(400);
		const valid = await app.request(path, {
			method: "POST",
			headers,
			body: JSON.stringify({ expectedRevision: 3, resolution: "keep" }),
		});
		expect(valid.status).toBe(204);
		expect(resolveReports).toHaveBeenCalledTimes(1);
		expect(resolveReports).toHaveBeenCalledWith(expect.any(Object), "submission-1", 3, "keep");
	});
	it("revalidates photo reads with ETag and skips the body transfer on match", async () => {
		const getPhoto = vi.fn<DiningSubmissionStore["getPhoto"]>(async () => ({
			etag: '"photo-1"',
			notModified: true,
		}));
		const { app } = fixture({ getPhoto });
		const revalidated = await app.request(
			"/api/ops/dining/submissions/submission-1/photos/photo-1",
			{
				headers: { "if-none-match": 'W/"photo-1"' },
			},
		);
		expect(revalidated.status).toBe(304);
		expect(revalidated.headers.get("cache-control")).toBe("private, no-cache");
		expect(revalidated.headers.get("etag")).toBe('"photo-1"');
		expect(getPhoto).toHaveBeenCalledWith("submission-1", "photo-1", 'W/"photo-1"');
		const getPhotoBytes = vi.fn<DiningSubmissionStore["getPhoto"]>(async () => ({
			bytes: new Uint8Array([1, 2, 3]),
			etag: '"photo-1"',
			notModified: false,
		}));
		const response = await fixture({ getPhoto: getPhotoBytes }).app.request(
			"/api/ops/dining/submissions/submission-1/photos/photo-1",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-cache");
		expect(response.headers.get("content-type")).toBe("image/webp");
		expect(response.headers.get("etag")).toBe('"photo-1"');
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("location")).toBeNull();
		expect(getPhotoBytes).toHaveBeenCalledWith("submission-1", "photo-1", null);
	});
});

describe("Ops submission private object reader", () => {
	it("uses only exact-prefix GetObject and keeps errors distinct from missing objects", async () => {
		const send = vi.fn(async (_command: unknown) => ({
			Body: { transformToByteArray: async () => new Uint8Array([1]) },
		}));
		const store = createS3DiningSubmissionAssetStore({
			bucket: "private-derived",
			client: { send },
		});
		expect(await store.get("dining/submissions/photo-1.webp")).toEqual(new Uint8Array([1]));
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
		await expect(store.get("dining/floorplans/photo-1.webp")).rejects.toThrow("引用无效");
		await expect(store.get("dining/submissions/../private.webp")).rejects.toThrow("引用无效");
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("does not substitute broad derived credentials for the dedicated reader", async () => {
		const store = createDiningSubmissionAssetStoreFromEnv({
			OBJECT_STORE_ENDPOINT: "http://unused.local",
		});
		await expect(store.get("dining/submissions/photo-1.webp")).rejects.toThrow("未配置");
	});
	it("returns null only for a missing key and propagates denied/dependency failures", async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NoSuchKey" }))
			.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }));
		const store = createS3DiningSubmissionAssetStore({
			bucket: "private-derived",
			client: { send },
		});
		expect(await store.get("dining/submissions/photo-1.webp")).toBeNull();
		await expect(store.get("dining/submissions/photo-1.webp")).rejects.toThrow("读取失败");
	});
});
