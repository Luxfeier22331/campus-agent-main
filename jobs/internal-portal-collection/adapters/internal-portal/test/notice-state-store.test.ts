import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import {
	createObjectStoreInternalPortalNoticeSyncStateStore,
	internalPortalNoticeSyncStateObjectKey,
} from "../src/notice-state-store.js";

describe("internal portal notice state store", () => {
	it("writes and reads the v4 half-open maintenance range", async () => {
		let existing: Uint8Array | null = null;
		const putObject = vi.fn(async (input: { body: Uint8Array }) => {
			existing = input.body;
		});
		const store = createObjectStoreInternalPortalNoticeSyncStateStore({
			objectStore: objectStore({
				getObjectIfExists: async () => existing,
				putObject,
			}),
		});
		const state = {
			coveredFrom: "2025-12-01",
			coveredUntil: "2026-08-27",
			updatedAt: "2026-08-26T02:30:07.000Z",
		};

		await store.save(state);
		await expect(store.load()).resolves.toEqual(state);
		expect(JSON.parse(Buffer.from(existing ?? []).toString("utf8"))).toEqual({
			covered_from: "2025-12-01",
			covered_until: "2026-08-27",
			schema_version: "internal_portal_notice_sync_state.v4",
			updated_at: "2026-08-26T02:30:07.000Z",
		});
	});

	it("reads a v2 state as a partial migration input without inventing covered_until", async () => {
		const bytes = Buffer.from(
			JSON.stringify({
				head_notice_id: 358195,
				history_covered_from: "2026-01-01",
				schema_version: "internal_portal_notice_sync_state.v2",
				updated_at: "2026-08-25T00:00:00.000Z",
			}),
		);
		const store = createObjectStoreInternalPortalNoticeSyncStateStore({
			objectStore: objectStore({ getObjectIfExists: async () => bytes }),
		});

		await expect(store.load()).resolves.toEqual({
			coveredFrom: "2026-01-01",
			coveredUntil: null,
			updatedAt: "2026-08-25T00:00:00.000Z",
		});
	});

	it("does not persist a partial migration state as v3", async () => {
		const store = createObjectStoreInternalPortalNoticeSyncStateStore({
			objectStore: objectStore(),
		});

		await expect(
			store.save({
				coveredFrom: "2026-01-01",
				coveredUntil: null,
				updatedAt: "2026-08-26T02:30:07.000Z",
			}),
		).rejects.toThrow("requires both maintenance boundaries");
	});

	it("keeps the established state object key", () => {
		expect(internalPortalNoticeSyncStateObjectKey()).toBe("internal_portal/notices/_state.json");
	});
});

function objectStore(
	overrides: Partial<InternalPortalCollectionObjectStore> = {},
): InternalPortalCollectionObjectStore {
	return {
		createObject: async () => "created",
		getObject: async () => new Uint8Array(),
		getObjectIfExists: async () => null,
		hasObject: async () => false,
		putObject: async () => undefined,
		sourceBucket: "campus-agent-source",
		...overrides,
	};
}
