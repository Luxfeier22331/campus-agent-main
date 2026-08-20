import { PortalCredentialExpiredError } from "@campus-agent/internal-portal-client";
import { describe, expect, it, vi } from "vitest";
import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import { listFileReleaseIds, runFileSync } from "../src/file-sync.js";

const env = {
	INTERNAL_PORTAL_SSO_TGC: "TGT-test",
	OBJECT_STORE_BUCKET_SOURCE: "source",
	OBJECT_STORE_ENDPOINT: "http://object-store:9000",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "access",
	OBJECT_STORE_SOURCE_SECRET_KEY: "secret",
};

function objectStore(): InternalPortalCollectionObjectStore {
	return {
		sourceBucket: "source",
		close: vi.fn(async () => undefined),
		createOrVerifyObject: vi.fn(),
		createOrVerifyStream: vi.fn(),
		getObject: vi.fn(),
		getObjectIfExists: vi.fn(),
		putObject: vi.fn(),
	};
}

function apiContext() {
	return {
		dispose: vi.fn(async () => undefined),
		get: vi.fn(),
		post: vi.fn(),
	};
}

describe("internal portal file sync", () => {
	it("paginates the inventory and rejects duplicate IDs", async () => {
		const context = apiContext();
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				datas: { page: { totalCounts: 2 }, tables: [{ id: 646 }] },
				state: true,
			})
			.mockResolvedValueOnce({
				datas: { page: { totalCounts: 2 }, tables: [{ id: "647" }] },
				state: true,
			});

		await expect(
			listFileReleaseIds({} as never, {
				createApiContext: async () => context,
				fetchPage,
			}),
		).resolves.toEqual([646, 647]);
		expect(fetchPage).toHaveBeenNthCalledWith(2, { apiContext: context, currentPage: 2 });
		expect(context.dispose).toHaveBeenCalledOnce();

		await expect(
			listFileReleaseIds({} as never, {
				createApiContext: async () => apiContext(),
				fetchPage: vi.fn(async () => ({
					datas: { page: { totalCounts: 2 }, tables: [{ id: 646 }, { id: 646 }] },
					state: true,
				})),
			}),
		).rejects.toThrow("duplicate ID 646");
	});

	it("captures sequentially and reports written, reused and failed", async () => {
		const store = objectStore();
		let active = 0;
		let maximumActive = 0;
		const order: number[] = [];
		const capture = vi.fn(async ({ fileReleaseId }: { fileReleaseId: number }) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			order.push(fileReleaseId);
			await Promise.resolve();
			active -= 1;
			if (fileReleaseId === 648) {
				throw Object.assign(new Error("download failed"), { name: "DownloadFailed" });
			}
			return {
				disposition: fileReleaseId === 647 ? ("reused" as const) : ("written" as const),
				fileReleaseId,
				sourceKey: `files/${fileReleaseId}/source.json`,
			};
		});
		const running = runFileSync(
			{ env },
			{
				capture: capture as never,
				createApiContext: async () => apiContext(),
				createObjectStore: () => store,
				fetchPage: vi.fn(async () => ({
					datas: { page: { totalCounts: 3 }, tables: [{ id: 646 }, { id: 647 }, { id: 648 }] },
					state: true,
				})),
			},
		);
		await expect(running).resolves.toEqual({
			failed: 1,
			failures: [{ errorCode: "DownloadFailed", fileReleaseId: 648 }],
			reused: 1,
			scanned: 3,
			written: 1,
		});
		expect(order).toEqual([646, 647, 648]);
		expect(maximumActive).toBe(1);
		expect(store.close).toHaveBeenCalledOnce();
	});

	it("aborts the batch on an authentication failure", async () => {
		const store = objectStore();
		await expect(
			runFileSync(
				{ env },
				{
					capture: vi.fn(async () => {
						throw new PortalCredentialExpiredError();
					}) as never,
					createApiContext: async () => apiContext(),
					createObjectStore: () => store,
					fetchPage: vi.fn(async () => ({
						datas: { page: { totalCounts: 1 }, tables: [{ id: 646 }] },
						state: true,
					})),
				},
			),
		).rejects.toBeInstanceOf(PortalCredentialExpiredError);
		expect(store.close).toHaveBeenCalledOnce();
	});
});
