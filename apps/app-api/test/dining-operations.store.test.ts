// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	diningAuditEvents,
	diningDraftVersions,
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
	diningReviewProjections,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "../src/db/schema";
import type { AppApiRouteError } from "../src/http";
import {
	buildDiningOperationsService,
	createDevDiningOperationsState,
	createInMemoryDiningOperationsStore,
	createPgDiningOperationsStore,
} from "../src/modules/dining-ops";

const OPERATOR = {
	displayName: "Ops User",
	principalId: "operator_01",
};

const DINING_TABLES = [
	diningAuditEvents,
	diningDraftVersions,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReviewProjections,
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
	const insertValues = vi.fn(async (_payload: unknown) => undefined);
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
		insert: vi.fn(() => ({ values: insertValues })),
		select: vi.fn(() => ({
			from: (table: object) => createSelectableRows(rows.get(table) ?? []),
		})),
		transaction,
	};
	return { db, insertValues, transaction, tx };
}

function createSerialOnlyDiningDb(rows: Map<object, unknown[]> = new Map()) {
	let activeSelects = 0;
	const createSerialQuery = (table: object) => {
		const query = (async () => {
			if (activeSelects > 0) {
				throw new Error("concurrent dining state load query");
			}
			activeSelects += 1;
			await Promise.resolve();
			activeSelects -= 1;
			return rows.get(table) ?? [];
		})();
		return Object.assign(query, {
			orderBy: () => query,
		});
	};
	const db = {
		select: vi.fn(() => ({
			from: createSerialQuery,
		})),
	};
	return { db };
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

	it("loads persisted dining state without issuing parallel table scans", async () => {
		const { db } = createSerialOnlyDiningDb(emptyDiningRows());
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
		const memoryStore = createInMemoryDiningOperationsStore(createDevDiningOperationsState());
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
		const state = createDevDiningOperationsState();
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
});
