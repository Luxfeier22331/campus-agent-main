import { describe, expect, it, vi } from "vitest";

import { LarkDiningClient } from "../src/lark-client.ts";

const REQUIRED_FIELD_IDS = [
	"fldGE8Z5vG",
	"fldmJk9inX",
	"fldPRZItgB",
	"flduqrX7Ab",
	"fldomqSoKM",
	"fldOWOVRMX",
	"fldIBfi1eC",
	"fldyqctdoB",
	"fldHJzHJpX",
] as const;

function inputUrl(input: string | URL | Request): string {
	return input instanceof Request ? input.url : String(input);
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function tokenResponse() {
	return json({
		code: 0,
		expire: 7_200,
		msg: "ok",
		tenant_access_token: "tenant-token",
	});
}

function createClient(fetchImpl: typeof fetch, now = () => 1_000) {
	return new LarkDiningClient({
		appId: "cli_app",
		appSecret: "secret",
		baseToken: "base",
		fetch: fetchImpl,
		now,
		review: { tableId: "review", viewId: "view" },
	});
}

describe("Lark Dining client", () => {
	it("caches tenant tokens across attachment downloads", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = inputUrl(input);
			return url.includes("tenant_access_token")
				? tokenResponse()
				: new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } });
		}) as unknown as typeof fetch;
		const client = createClient(fetchImpl);

		await expect(client.downloadAttachment("file-1")).resolves.toEqual(new Uint8Array([1, 2, 3]));
		await expect(client.downloadAttachment("file-2")).resolves.toEqual(new Uint8Array([1, 2, 3]));

		const calls = vi.mocked(fetchImpl).mock.calls.map(([input]) => inputUrl(input));
		expect(calls.filter((url) => url.includes("tenant_access_token"))).toHaveLength(1);
		expect(calls.filter((url) => url.includes("/drive/v1/medias/"))).toHaveLength(2);
	});

	it("retries transient Lark HTTP failures with a finite budget", async () => {
		let downloadAttempts = 0;
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			if (inputUrl(input).includes("tenant_access_token")) {
				return tokenResponse();
			}
			downloadAttempts += 1;
			return downloadAttempts < 3
				? new Response("busy", { status: 503 })
				: new Response(new Uint8Array([7]), { status: 200 });
		}) as unknown as typeof fetch;

		await expect(createClient(fetchImpl).downloadAttachment("file-1")).resolves.toEqual(
			new Uint8Array([7]),
		);
		expect(downloadAttempts).toBe(3);
	});

	it("rejects repeated pagination tokens instead of looping forever", async () => {
		let recordPage = 0;
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = inputUrl(input);
			if (url.includes("tenant_access_token")) {
				return tokenResponse();
			}
			if (url.includes("/fields")) {
				return json({
					code: 0,
					data: {
						has_more: false,
						items: REQUIRED_FIELD_IDS.map((fieldId, index) => ({
							field_id: fieldId,
							field_name: `field-${index}`,
						})),
					},
					msg: "ok",
				});
			}
			recordPage += 1;
			return json({
				code: 0,
				data: { has_more: true, items: [], page_token: "same-page" },
				msg: "ok",
			});
		}) as unknown as typeof fetch;

		await expect(createClient(fetchImpl).listReviewRecords()).rejects.toThrow(
			/repeated page token same-page/,
		);
		expect(recordPage).toBe(2);
	});

	it("turns an invalid source row into a blocked diagnostic record", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = inputUrl(input);
			if (url.includes("tenant_access_token")) {
				return tokenResponse();
			}
			if (url.includes("/fields")) {
				return json({
					code: 0,
					data: {
						has_more: false,
						items: REQUIRED_FIELD_IDS.map((fieldId, index) => ({
							field_id: fieldId,
							field_name: `field-${index}`,
						})),
					},
					msg: "ok",
				});
			}
			return json({
				code: 0,
				data: {
					has_more: false,
					items: [{ created_time: "1782892800000", fields: {}, record_id: "bad-row" }],
				},
				msg: "ok",
			});
		}) as unknown as typeof fetch;

		await expect(createClient(fetchImpl).listReviewRecords()).resolves.toEqual({
			complete: true,
			records: [
				expect.objectContaining({
					sourceBlockReason: "source_record_invalid",
					sourceRecordId: "bad-row",
				}),
			],
		});
	});

	it("enforces the streamed attachment size even without Content-Length", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			if (inputUrl(input).includes("tenant_access_token")) {
				return tokenResponse();
			}
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}) as unknown as typeof fetch;

		await expect(createClient(fetchImpl).downloadAttachment("file-1", 3)).rejects.toThrow(
			/exceeds the 3 byte limit/,
		);
	});
});
