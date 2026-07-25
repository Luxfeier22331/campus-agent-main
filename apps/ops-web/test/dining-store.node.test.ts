// @vitest-environment node

import type { DiningMapRelease } from "@campus-agent/dining/domain";
import {
	DINING_BOOTSTRAP_FLOORPLANS,
	type DiningFloorplanBundleV1,
} from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { describe, expect, it, vi } from "vitest";
import type { DiningFloorplanAssetStore } from "../src/server/dining-floorplan-assets";
import {
	createPgDiningStore,
	DiningStoreConflictError,
	DiningStoreUnavailableError,
} from "../src/server/dining-store";

const NOW = new Date("2026-07-24T08:00:00.000Z");

describe("PostgreSQL Dining map store", () => {
	it("keeps a no-change save idempotent", async () => {
		const harness = createHarness();
		const store = createStore(harness);

		const saved = await store.saveDraft(operator, DINING_BOOTSTRAP_FLOORPLANS, 1);

		expect(saved.revision).toBe(1);
		expect(harness.draft.revision).toBe(1);
	});

	it("rejects stale draft revisions", async () => {
		const harness = createHarness();
		const store = createStore(harness);

		await expect(store.saveDraft(operator, changedBundle(), 9)).rejects.toBeInstanceOf(
			DiningStoreConflictError,
		);
		expect(harness.draft.revision).toBe(1);
	});

	it("publishes each fingerprint once", async () => {
		const harness = createHarness();
		const store = createStore(harness);

		const first = await store.publish(operator, 1);
		const second = await store.publish(operator, 1);

		expect(second.releaseId).toBe(first.releaseId);
		expect(harness.releases).toHaveLength(1);
		expect(harness.publicationReleaseId).toBe(first.releaseId);
		expect(harness.assets.putSvg).toHaveBeenCalledTimes(DINING_BOOTSTRAP_FLOORPLANS.layouts.length);
	});

	it("does not change publication when object storage fails", async () => {
		const harness = createHarness();
		vi.mocked(harness.assets.putSvg).mockRejectedValue(new Error("storage unavailable"));
		const store = createStore(harness);

		await expect(store.publish(operator, 1)).rejects.toBeInstanceOf(DiningStoreUnavailableError);
		expect(harness.releases).toHaveLength(0);
		expect(harness.publicationReleaseId).toBeNull();
	});

	it("blocks publishing a map that removes a window with active menu items", async () => {
		const harness = createHarness();
		const window = DINING_BOOTSTRAP_FLOORPLANS.layouts[0]?.windows[0];
		const layout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
		if (!(window && layout)) {
			throw new Error("Dining bootstrap needs one window.");
		}
		harness.activeMenuWindowIds.push(`${layout.hallId}:${layout.floorId}:${window.anchorId}`);
		const changed = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
		changed.layouts[0]?.windows.splice(0, 1);
		const store = createStore(harness);
		await store.saveDraft(operator, changed, 1);

		await expect(store.publish(operator, 2)).rejects.toMatchObject({
			details: { windowIds: harness.activeMenuWindowIds },
		});
		expect(harness.releases).toHaveLength(0);
	});

	it("restores an old version as a new release and updates the draft", async () => {
		const harness = createHarness();
		const store = createStore(harness);
		const first = await store.publish(operator, 1);
		const changed = changedBundle();
		await store.saveDraft(operator, changed, 1);
		const second = await store.publish(operator, 2);

		const restored = await store.restore(operator, first.releaseId, 2);

		expect(restored.release.kind).toBe("restore");
		expect(restored.release.releaseId).not.toBe(first.releaseId);
		expect(restored.release.releaseId).not.toBe(second.releaseId);
		expect(restored.release.restoredFromReleaseId).toBe(first.releaseId);
		expect(restored.draft.fingerprint).toBe(first.snapshotHash);
		expect(harness.releases).toHaveLength(3);
		expect(harness.publicationReleaseId).toBe(restored.release.releaseId);
	});
});

const operator = { displayName: "值班员", principalId: "ops:1" };

function changedBundle(): DiningFloorplanBundleV1 {
	const bundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
	const window = bundle.layouts[0]?.windows[0];
	if (!window) {
		throw new Error("Dining bootstrap needs one window.");
	}
	window.label = `${window.label}（调整）`;
	return bundle;
}

function createStore(harness: ReturnType<typeof createHarness>) {
	let id = 0;
	return createPgDiningStore({
		assetStore: harness.assets,
		now: () => NOW,
		pool: harness.pool as never,
		releaseId: () => `release-${++id}`,
	});
}

function createHarness() {
	const initialBundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
	const state = {
		activeMenuWindowIds: [] as string[],
		draft: {
			bundleJson: initialBundle,
			fingerprint: diningMapBundleFingerprint(initialBundle),
			revision: 1,
			updatedAt: NOW,
			updatedBy: "bootstrap",
		},
		publicationReleaseId: null as string | null,
		releases: [] as DiningMapRelease[],
	};
	const assets: DiningFloorplanAssetStore = {
		putSvg: vi.fn(async ({ sha256 }) => ({
			objectKey: `dining/floorplans/${sha256.slice(7)}.svg`,
			sha256,
			svgAssetUrl: `/api/dining/floorplans/${sha256.slice(7)}.svg`,
		})),
		verifyReadiness: vi.fn(async () => undefined),
	};
	const query = vi.fn(async (sql: string, values: unknown[] = []) => {
		const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
		if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
			return { rows: [] };
		}
		if (normalized.startsWith("select bundle_json, fingerprint, revision")) {
			return { rows: [draftRow(state.draft)] };
		}
		if (normalized.startsWith("select distinct window_id from dining.menu_items")) {
			return { rows: state.activeMenuWindowIds.map((windowId) => ({ window_id: windowId })) };
		}
		if (normalized.startsWith("update dining.map_draft")) {
			state.draft = {
				bundleJson: values[0] as DiningFloorplanBundleV1,
				fingerprint: values[1] as `sha256:${string}`,
				revision: values[2] as number,
				updatedAt: new Date(String(values[3])),
				updatedBy: String(values[4]),
			};
			return { rows: [] };
		}
		if (normalized.includes("from dining.map_publication publication join dining.map_releases")) {
			const release = state.releases.find((item) => item.releaseId === state.publicationReleaseId);
			return { rows: release ? [releaseRow(release)] : [] };
		}
		if (
			normalized.startsWith("select release_id, updated_at, updated_by from dining.map_publication")
		) {
			return {
				rows: state.publicationReleaseId
					? [{ release_id: state.publicationReleaseId, updated_at: NOW, updated_by: "ops:1" }]
					: [],
			};
		}
		if (normalized.includes("from dining.map_releases where release_id = $1")) {
			const release = state.releases.find((item) => item.releaseId === values[0]);
			return { rows: release ? [releaseRow(release)] : [] };
		}
		if (normalized.includes("from dining.map_releases order by created_at desc")) {
			return { rows: [...state.releases].reverse().map(releaseRow) };
		}
		if (normalized.startsWith("insert into dining.map_releases")) {
			state.releases.push({
				bundle: values[5] as DiningFloorplanBundleV1,
				createdAt: String(values[7]),
				createdBy: String(values[8]),
				draftRevision: values[2] as number,
				kind: values[3] as DiningMapRelease["kind"],
				publicPayload: values[6] as DiningMapRelease["publicPayload"],
				releaseId: String(values[0]),
				restoredFromReleaseId: values[4] === null ? null : String(values[4]),
				snapshotHash: values[1] as `sha256:${string}`,
			});
			return { rows: [] };
		}
		if (normalized.startsWith("insert into dining.map_publication")) {
			state.publicationReleaseId = String(values[1]);
			return { rows: [] };
		}
		if (normalized.startsWith("select 1 from dining.map_draft")) {
			return { rows: [{ "?column?": 1 }] };
		}
		throw new Error(`Unexpected SQL: ${normalized}`);
	});
	const client = { query, release: vi.fn() };
	return {
		assets,
		activeMenuWindowIds: state.activeMenuWindowIds,
		get draft() {
			return state.draft;
		},
		get publicationReleaseId() {
			return state.publicationReleaseId;
		},
		pool: { connect: vi.fn(async () => client), query },
		get releases() {
			return state.releases;
		},
	};
}

function draftRow(draft: {
	bundleJson: DiningFloorplanBundleV1;
	fingerprint: `sha256:${string}`;
	revision: number;
	updatedAt: Date;
	updatedBy: string;
}) {
	return {
		bundle_json: draft.bundleJson,
		fingerprint: draft.fingerprint,
		revision: draft.revision,
		updated_at: draft.updatedAt,
		updated_by: draft.updatedBy,
	};
}

function releaseRow(release: DiningMapRelease) {
	return {
		bundle_json: release.bundle,
		created_at: release.createdAt,
		created_by: release.createdBy,
		draft_revision: release.draftRevision,
		kind: release.kind,
		public_payload_json: release.publicPayload,
		release_id: release.releaseId,
		restored_from_release_id: release.restoredFromReleaseId,
		snapshot_hash: release.snapshotHash,
	};
}
