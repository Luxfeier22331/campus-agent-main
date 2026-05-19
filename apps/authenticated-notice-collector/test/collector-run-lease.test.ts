import { describe, expect, it } from "vitest";

import {
	createInMemoryCollectorRunLeaseStore,
	resolveCollectorRunLeaseTableReference,
	withCollectorRunLease,
} from "../src/collector-run-lease.js";

describe("authenticated notice collector run lease", () => {
	it("keeps raw schema and quoted table SQL separate for postgres lease DDL", () => {
		expect(
			resolveCollectorRunLeaseTableReference(
				"ingestion_projection.authenticated_notice_collector_lease",
			),
		).toEqual({
			schemaSql: '"ingestion_projection"',
			tableSql: '"ingestion_projection"."authenticated_notice_collector_lease"',
		});
	});

	it("fails closed when another live run owns the same source-surface lease", async () => {
		const store = createInMemoryCollectorRunLeaseStore();
		await store.acquire({
			leaseKey: "authenticated_notice_portal:notice:muc_internal_portal",
			ownerId: "run-a",
			now: "2026-04-12T00:30:00.000Z",
			ttlSeconds: 300,
		});

		await expect(
			withCollectorRunLease(
				store,
				{
					leaseKey: "authenticated_notice_portal:notice:muc_internal_portal",
					ownerId: "run-b",
					now: "2026-04-12T00:31:00.000Z",
					ttlSeconds: 300,
				},
				async () => "unexpected",
			),
		).rejects.toThrow("collector run lease unavailable");
	});

	it("releases an acquired lease after the guarded operation completes", async () => {
		const store = createInMemoryCollectorRunLeaseStore();

		const result = await withCollectorRunLease(
			store,
			{
				leaseKey: "authenticated_notice_portal:file_release:muc_internal_portal",
				ownerId: "run-a",
				now: "2026-04-12T00:30:00.000Z",
				ttlSeconds: 300,
			},
			async () => "completed",
		);

		expect(result).toBe("completed");
		await expect(
			withCollectorRunLease(
				store,
				{
					leaseKey: "authenticated_notice_portal:file_release:muc_internal_portal",
					ownerId: "run-b",
					now: "2026-04-12T00:31:00.000Z",
					ttlSeconds: 300,
				},
				async () => "second-run",
			),
		).resolves.toBe("second-run");
	});
});
