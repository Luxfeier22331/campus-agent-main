// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	diningAuditEvents,
	diningDraftVersions,
	diningFloorplanAssets,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseCandidates,
	diningReleaseCandidateValidationReports,
	diningReleaseLatestPointer,
	diningReleaseScheduleJobs,
	diningReleaseSnapshots,
	diningReleases,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "../src/db/schema";
import type { AppApiRouteError } from "../src/http";
import {
	buildDiningOperationsService,
	createInitialDiningOperationsState,
	createInMemoryDiningOperationsStore,
	createPgDiningOperationsStore,
	type DiningFloorplanObjectStore,
	ensureInitialDiningOperationsRelease,
} from "../src/modules/dining-ops";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};

const DINING_TABLES = [
	diningAuditEvents,
	diningDraftVersions,
	diningFloors,
	diningFloorplanAssets,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseCandidateValidationReports,
	diningReleaseCandidates,
	diningReleaseLatestPointer,
	diningReleaseScheduleJobs,
	diningReleaseSnapshots,
	diningReleases,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
] as const;

function createQuery(rows: unknown[]) {
	const promise = Promise.resolve(rows);
	return {
		catch: promise.catch.bind(promise),
		finally: promise.finally.bind(promise),
		limit: () => Promise.resolve(rows),
		orderBy: () => Promise.resolve(rows),
		where: () => ({
			limit: () => Promise.resolve(rows),
		}),
	};
}

function createSelectableRows(rows: unknown[]) {
	return Object.assign(Promise.resolve(rows), createQuery(rows));
}

function createFakeDiningDb(rows: Map<object, unknown[]> = new Map()) {
	const insertValues = vi.fn(() => Promise.resolve());
	const tx = {
		delete: vi.fn(() => Promise.resolve()),
		insert: vi.fn(() => ({ values: insertValues })),
	};
	interface FakeTx {
		delete: typeof tx.delete;
		insert: typeof tx.insert;
	}
	const transaction = vi.fn(async (callback: (tx: FakeTx) => Promise<void>) => callback(tx));
	const db = {
		select: vi.fn(() => ({
			from: (table: object) => createSelectableRows(rows.get(table) ?? []),
		})),
		transaction,
	};
	return { db, insertValues, transaction, tx };
}

function emptyDiningRows() {
	return new Map<object, unknown[]>(DINING_TABLES.map((table) => [table, []]));
}

describe("dining operations store", () => {
	it("fails closed instead of reseeding when persisted dining draft version is missing", async () => {
		const { db } = createFakeDiningDb(emptyDiningRows());
		const store = createPgDiningOperationsStore({} as never, {
			getDb: async () => db as never,
		});

		await expect(store.getState()).rejects.toMatchObject({
			code: "dining_operations_state_invalid",
			name: "AppApiRouteError",
			status: 500,
		} satisfies Partial<AppApiRouteError>);
	});

	it("rejects candidate rows whose frozen snapshot payload is missing before persistence", async () => {
		const memoryStore = createInMemoryDiningOperationsStore();
		const service = buildDiningOperationsService({ store: memoryStore });
		const candidate = await service.createReleaseCandidate({
			actor: OPERATOR,
			input: { notes: "准备发布候选" },
		});
		const state = await memoryStore.getState();
		delete state.candidateSnapshots[candidate.candidate.candidateId];
		const { db, transaction } = createFakeDiningDb();
		const store = createPgDiningOperationsStore({} as never, {
			getDb: async () => db as never,
		});

		await expect(store.saveState(state)).rejects.toMatchObject({
			code: "dining_operations_state_invalid",
			name: "AppApiRouteError",
			status: 500,
		} satisfies Partial<AppApiRouteError>);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("rejects release snapshots without matching release metadata before persistence", async () => {
		const state = createInitialDiningOperationsState();
		state.releaseSnapshots["dining_release:orphan"] = state.publishedSnapshot ?? {
			floors: {},
			halls: [],
			source: {
				label: "invalid",
				releaseId: "dining_release:orphan",
				updatedAt: "2026-06-11T00:00:00.000Z",
			},
		};
		const { db, transaction } = createFakeDiningDb();
		const store = createPgDiningOperationsStore({} as never, {
			getDb: async () => db as never,
		});

		await expect(store.saveState(state)).rejects.toMatchObject({
			code: "dining_operations_state_invalid",
			name: "AppApiRouteError",
			status: 500,
		} satisfies Partial<AppApiRouteError>);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("materializes initial dining floorplan SVG objects before saving the initial release", async () => {
		const { db } = createFakeDiningDb(emptyDiningRows());
		const objectStore = createFakeFloorplanObjectStore();

		const seeded = await ensureInitialDiningOperationsRelease({
			db: db as never,
			floorplanObjectStore: objectStore,
		});

		expect(seeded).toBe(true);
		expect(objectStore.puts.length).toBeGreaterThan(0);
		expect(objectStore.puts[0]).toMatchObject({
			contentType: "image/svg+xml",
			objectKey: expect.stringMatching(/^dining\/floorplans\/assets\//),
		});
	});
});

function createFakeFloorplanObjectStore(): DiningFloorplanObjectStore & {
	puts: Array<{ contentType: string; objectKey: string }>;
} {
	const puts: Array<{ contentType: string; objectKey: string }> = [];
	return {
		bucket: "campus-rag-derived-test",
		async copyObject(input) {
			return {
				bucket: "campus-rag-derived-test",
				byteSize: 1,
				contentType: "image/svg+xml",
				objectKey: input.targetObjectKey,
				sha256: input.sha256,
			};
		},
		async headObject(input) {
			return {
				bucket: "campus-rag-derived-test",
				byteSize: 1,
				contentType: input.objectKey.endsWith(".json") ? "application/json" : "image/svg+xml",
				objectKey: input.objectKey,
				sha256: "",
			};
		},
		async putJson(input) {
			return {
				bucket: "campus-rag-derived-test",
				byteSize: JSON.stringify(input.value).length,
				contentType: "application/json",
				objectKey: input.objectKey,
				sha256: "",
			};
		},
		async putSvg(input) {
			puts.push({ contentType: "image/svg+xml", objectKey: input.objectKey });
			return {
				bucket: "campus-rag-derived-test",
				byteSize: input.svgMarkup.length,
				contentType: "image/svg+xml",
				objectKey: input.objectKey,
				sha256: input.sha256,
			};
		},
		puts,
	};
}
