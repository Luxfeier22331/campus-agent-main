import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import {
	createObjectStoreInternalPortalNoticeSyncStateStore,
	internalPortalNoticeSyncStateObjectKey,
} from "../src/notice-state-store.js";

describe("internal portal notice state store", () => {
	it("writes and reads the minimal portal-wide state", async () => {
		let existing: Uint8Array | null = null;
		const putObject = vi.fn(async (input: { body: Uint8Array }) => {
			existing = input.body;
			return { byteSize: input.body.byteLength, contentSha256: "a" };
		});
		const store = createObjectStoreInternalPortalNoticeSyncStateStore({
			objectStore: objectStore({
				getObjectIfExists: async () => existing,
				putObject,
			}),
		});
		const state = {
			headNoticeId: 358195,
			historyCoveredFrom: "2026-08-03",
			updatedAt: "2026-08-11T02:30:07.000Z",
		};

		await store.save(state);
		await expect(store.load()).resolves.toEqual(state);
		expect(internalPortalNoticeSyncStateObjectKey()).toBe("internal_portal/notices/_state.json");
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
		putObject: async () => ({ byteSize: 0, contentSha256: "a" }),
		sourceBucket: "campus-agent-source",
		...overrides,
	};
}
