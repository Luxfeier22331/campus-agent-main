import { describe, expect, it, vi } from "vitest";

import type { DiningSourceObservation } from "../src/catalog-source-types.ts";
import {
	DiningEmptySnapshotError,
	PostgresDiningSourceObservationStore,
} from "../src/source-observation-store.ts";

const OBSERVATION: DiningSourceObservation = {
	observationId: "feishu:campus:1",
	observedAt: "2026-07-01T00:00:00.000Z",
	payloadJson: { campusName: "海淀校区", sourceRecordId: "1" },
	sourceType: "feishu_catalog",
	status: "accepted",
	targetId: "campus:1",
	targetKind: "campus",
};

function createStore(rowsFor: (sql: string) => Record<string, unknown>[]) {
	const queries: Array<{ sql: string; values?: unknown[] }> = [];
	const client = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		query: vi.fn(async (sql: string, values?: unknown[]) => {
			queries.push({ sql, values });
			return { rows: rowsFor(sql) };
		}),
	};
	return {
		client,
		queries,
		store: new PostgresDiningSourceObservationStore({ createClient: () => client }),
	};
}

describe("Dining source observation store", () => {
	it("creates a visible run and closes abandoned runs before network work", async () => {
		const fixture = createStore(() => []);

		const run = await fixture.store.startRun("feishu_catalog");

		expect(run.runId).toMatch(/^dining_feishu_catalog_sync:/);
		expect(fixture.queries[0]?.sql).toContain("error_code='run_abandoned'");
		expect(fixture.queries[1]?.sql).toContain("VALUES($1,$2,$3,'running'");
	});

	it("rejects an empty snapshot when active source observations exist", async () => {
		const fixture = createStore((sql) =>
			sql.includes("SELECT count(*)::int") ? [{ count: 2 }] : [],
		);

		await expect(
			fixture.store.completeCatalogRun({
				observations: [],
				run: {
					runId: "dining_feishu_catalog_sync:test",
					sourceType: "feishu_catalog",
					startedAt: new Date(),
				},
				sourceIdentity: {
					baseToken: "base",
					campusTableId: "campus",
					dishTableId: "dish",
					hallTableId: "hall",
					stallTableId: "stall",
				},
			}),
		).rejects.toBeInstanceOf(DiningEmptySnapshotError);
		expect(fixture.queries.at(-1)?.sql).toBe("ROLLBACK");
		expect(fixture.queries.some(({ sql }) => sql.includes("SET stale_at"))).toBe(false);
	});

	it("commits all observations before marking absent records stale", async () => {
		const fixture = createStore((sql) => {
			if (sql.includes("SELECT count(*)::int")) {
				return [{ count: 1 }];
			}
			if (sql.includes("RETURNING observation_id")) {
				return [{ observation_id: "stale" }];
			}
			return [];
		});

		await expect(
			fixture.store.completeCatalogRun({
				observations: [OBSERVATION],
				run: {
					runId: "dining_feishu_catalog_sync:test",
					sourceType: "feishu_catalog",
					startedAt: new Date(),
				},
				sourceIdentity: {
					baseToken: "base",
					campusTableId: "campus",
					dishTableId: "dish",
					hallTableId: "hall",
					stallTableId: "stall",
				},
			}),
		).resolves.toMatchObject({ staleCount: 1, totalCount: 1 });
		const upsertIndex = fixture.queries.findIndex(({ sql }) => sql.includes("ON CONFLICT"));
		const staleIndex = fixture.queries.findIndex(({ sql }) => sql.includes("SET stale_at"));
		expect(upsertIndex).toBeGreaterThan(-1);
		expect(staleIndex).toBeGreaterThan(upsertIndex);
		expect(fixture.queries.at(-1)?.sql).toBe("COMMIT");
	});

	it("records bounded failure diagnostics on the active run", async () => {
		const fixture = createStore(() => []);
		const run = {
			runId: "dining_feishu_review_sync:test",
			sourceType: "feishu_review" as const,
			startedAt: new Date(),
		};

		await fixture.store.failRun(run, "sync_failed", new Error("provider unavailable"));

		expect(fixture.queries[0]?.values?.slice(1)).toEqual([
			"sync_failed",
			"provider unavailable",
			run.runId,
		]);
	});
});
