import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import {
	createInternalPortalNoticeMetaStore,
	internalPortalNoticeMetaObjectKey,
} from "../src/notice-meta-store.js";

describe("internal portal notice metadata store", () => {
	it("writes the portal-wide mapping and reuses unchanged content", async () => {
		const putObject = vi.fn(async (_input: unknown) => ({ byteSize: 1, contentSha256: "a" }));
		let existing: Uint8Array | null = null;
		const store = createInternalPortalNoticeMetaStore({
			objectStore: objectStore({
				getObjectIfExists: async () => existing,
				putObject: async (input) => {
					putObject(input);
					existing = input.body instanceof Uint8Array ? input.body : new Uint8Array();
					return { byteSize: 1, contentSha256: "a" };
				},
			}),
		});
		const mappings = {
			noticeTypes: { "5": "办公通知" },
			organizations: { "00007": "党委保卫部、保卫处" },
			updatedAt: "2026-08-11T02:30:07.000Z",
		};

		await expect(store.putMappings(mappings)).resolves.toBe("written");
		await expect(
			store.putMappings({ ...mappings, updatedAt: "2026-08-12T02:30:07.000Z" }),
		).resolves.toBe("reused");
		expect(putObject).toHaveBeenCalledOnce();
		expect(internalPortalNoticeMetaObjectKey()).toBe("internal_portal/meta.json");
	});

	it("retains historical mappings that are absent from the current portal selectors", async () => {
		let written: Uint8Array | null = null;
		const existing = Buffer.from(
			JSON.stringify({
				notice_types: { "5": "旧办公通知" },
				organizations: {
					"00007": "保卫处（旧名称）",
					"00020-1": "离退休工作处、离退休教职工党委",
				},
				schema_version: "internal_portal_meta.v1",
				updated_at: "2026-08-11T02:30:07.000Z",
			}),
		);
		const store = createInternalPortalNoticeMetaStore({
			objectStore: objectStore({
				getObjectIfExists: async () => existing,
				putObject: async (input) => {
					written = input.body instanceof Uint8Array ? input.body : null;
					return { byteSize: 1, contentSha256: "a" };
				},
			}),
		});

		await expect(
			store.putMappings({
				noticeTypes: { "5": "办公通知", "36": "活动报道" },
				organizations: { "00007": "党委保卫部、保卫处" },
				updatedAt: "2026-08-13T02:30:07.000Z",
			}),
		).resolves.toBe("written");
		expect(JSON.parse(Buffer.from(written ?? []).toString("utf8"))).toMatchObject({
			notice_types: { "5": "办公通知", "36": "活动报道" },
			organizations: {
				"00007": "党委保卫部、保卫处",
				"00020-1": "离退休工作处、离退休教职工党委",
			},
		});
	});
});

function objectStore(
	overrides: Partial<InternalPortalCollectionObjectStore> = {},
): InternalPortalCollectionObjectStore {
	return {
		createOrVerifyObject: async () => ({ byteSize: 0, contentSha256: "a" }),
		createOrVerifyStream: async () => {
			throw new Error("unexpected stream write");
		},
		getObject: async () => new Uint8Array(),
		getObjectIfExists: async () => null,
		pruneObjectVersions: async () => undefined,
		putObject: async () => ({ byteSize: 0, contentSha256: "a" }),
		sourceBucket: "campus-agent-source",
		...overrides,
	};
}
