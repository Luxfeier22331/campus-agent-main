import { describe, expect, it, vi } from "vitest";
import { createPostgresOfflineReleaseStore } from "../src/offline-release-store";

const digest = `sha256:${"1".repeat(64)}`;

describe("PostgreSQL offline release store", () => {
	it("does not mark a deferred reconcile as completed", async () => {
		let updateSql = "";
		const client = {
			release: vi.fn(),
			async query(sql: string) {
				if (sql.includes("UPDATE ingestion_control.offline_release_streams")) {
					updateSql = sql;
					return {
						rows: [
							{
								...streamRow(),
								last_check_mode: "reconcile",
								last_check_outcome: "deferred",
							},
						],
					};
				}
				return { rows: [] };
			},
		};
		const store = createPostgresOfflineReleaseStore({
			pool: { connect: async () => client },
		});

		await store.recordCheck({
			check: {
				...checkRecord(),
				mode: "reconcile",
				outcome: "deferred",
				errorCode: "internal_portal_source_deferred",
			},
			streamId: "internal_portal:muc:notice",
		});

		expect(updateSql).toContain("WHEN $2 = 'reconcile' AND $3 IN ('published', 'unchanged')");
		expect(client.release).toHaveBeenCalledOnce();
	});

	it("returns the committed run after the stream pointer has advanced", async () => {
		const statements: string[] = [];
		const release = releaseRow();
		const client = {
			release: vi.fn(),
			async query(sql: string) {
				statements.push(sql);
				if (sql.includes("offline_release_streams") && sql.includes("FOR UPDATE")) {
					return { rows: [streamRow()] };
				}
				if (sql.includes("offline_releases") && sql.includes("run_id = $2")) {
					return { rows: [release] };
				}
				return { rows: [] };
			},
		};
		const store = createPostgresOfflineReleaseStore({
			pool: { connect: async () => client },
		});

		const committed = await store.commitRelease({
			check: checkRecord(),
			checkpoint: { notices: [] },
			expectedStreamVersion: 0,
			release: releaseInput(release),
		});

		expect(committed).toMatchObject({
			release: { release_id: release.release_id, run_id: "run-001" },
			stream: { current_release_id: "release:run-002:v2", version: 2 },
		});
		expect(statements).toEqual([
			"BEGIN",
			expect.stringContaining("FOR UPDATE"),
			expect.stringContaining("run_id = $2"),
			"COMMIT",
		]);
		expect(client.release).toHaveBeenCalledOnce();
	});

	it("rejects a reused run with different release content", async () => {
		const release = releaseRow();
		const client = {
			release: vi.fn(),
			async query(sql: string) {
				if (sql.includes("offline_release_streams") && sql.includes("FOR UPDATE")) {
					return { rows: [streamRow()] };
				}
				if (sql.includes("offline_releases") && sql.includes("run_id = $2")) {
					return { rows: [release] };
				}
				return { rows: [] };
			},
		};
		const store = createPostgresOfflineReleaseStore({
			pool: { connect: async () => client },
		});

		await expect(
			store.commitRelease({
				check: checkRecord(),
				checkpoint: { notices: [] },
				expectedStreamVersion: 0,
				release: { ...releaseInput(release), manifest_ref: artifact("derived", "other.json") },
			}),
		).rejects.toThrow("offline release run identity conflict");
		expect(client.release).toHaveBeenCalledOnce();
	});
});

function releaseInput(release: ReturnType<typeof releaseRow>) {
	return {
		item_count: release.item_count,
		manifest_ref: release.manifest_ref_json,
		previous_release_id: release.previous_release_id,
		release_id: release.release_id,
		run_id: release.run_id,
		stream_id: release.stream_id,
		workflow_id: release.workflow_id,
		workflow_run_id: release.workflow_run_id,
	};
}

function checkRecord() {
	return {
		addedCount: 1,
		checkedAt: "2026-07-17T00:01:00.000Z",
		errorCode: null,
		mode: "incremental" as const,
		outcome: "published" as const,
		updatedCount: 0,
		withdrawnCount: 0,
	};
}

function streamRow() {
	return {
		checkpoint_json: { notices: [{ last_released_notice_id: 120, notice_type: "5" }] },
		collection: "internal_notice",
		corpus: "campus_notices",
		created_at: "2026-07-17T00:00:00.000Z",
		current_release_id: "release:run-002:v2",
		source_channel: "internal_portal",
		source_surface: "notice",
		stream_id: "internal_portal:muc:notice",
		updated_at: "2026-07-17T00:03:00.000Z",
		version: 2,
		last_check_at: "2026-07-17T00:02:00.000Z",
		last_check_mode: "incremental",
		last_check_outcome: "published",
		last_check_error_code: null,
		last_reconcile_at: null,
		last_published_at: "2026-07-17T00:02:00.000Z",
		last_added_count: 1,
		last_updated_count: 0,
		last_withdrawn_count: 0,
	};
}

function releaseRow() {
	return {
		committed_at: "2026-07-17T00:02:00.000Z",
		item_count: 1,
		manifest_ref_json: artifact("derived", "release-run-001.json"),
		previous_release_id: null,
		release_id: "release:run-001:v1",
		run_id: "run-001",
		stream_id: "internal_portal:muc:notice",
		workflow_id: "ingestion/notice/run-001",
		workflow_run_id: "run-001",
	};
}

function artifact(bucket: string, key: string) {
	return {
		byte_size: 1,
		digest,
		kind: "object_store" as const,
		uri: `s3://${bucket}/${key}`,
	};
}
