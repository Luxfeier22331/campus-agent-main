import type { IngestionOfflineReleaseItem } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	buildNextReleaseItems,
	compareReleaseItems,
	hasOfflineReleaseSemanticChange,
} from "../src/publication-activities";

const artifact = {
	byte_size: 1,
	digest: `sha256:${"a".repeat(64)}`,
	kind: "object_store" as const,
	role: "source_manifest",
	uri: "s3://derived/item/manifest.json",
};

describe("internal portal release semantics", () => {
	it("replaces the current notice set during a complete reconciliation", () => {
		const previous = [item("notice:a", "1"), item("notice:withdrawn", "1")];
		const incoming = [item("notice:a", "2"), item("notice:new", "1")];
		const next = buildNextReleaseItems({
			collectionMode: "reconcile",
			incoming,
			previous,
			surface: "notice",
		});

		expect(next.map((value) => value.item_id)).toEqual(["notice:a", "notice:new"]);
		expect(compareReleaseItems(previous, next)).toEqual({
			addedItemIds: ["notice:new"],
			updatedItemIds: ["notice:a"],
			withdrawnItemIds: ["notice:withdrawn"],
		});
	});

	it("merges an incremental notice check without withdrawing unseen items", () => {
		const next = buildNextReleaseItems({
			collectionMode: "incremental",
			incoming: [item("notice:a", "2")],
			previous: [item("notice:a", "1"), item("notice:b", "1")],
			surface: "notice",
		});
		expect(next.map((value) => `${value.item_id}:${value.version_id.at(-1)}`)).toEqual([
			"notice:a:2",
			"notice:b:1",
		]);
	});

	it("treats identical sorted items and checkpoints as unchanged", () => {
		const items = [item("notice:a", "1")];
		expect(
			hasOfflineReleaseSemanticChange({
				nextCheckpoint: { notices: [{ notice_type: "5", last_released_notice_id: 10 }] },
				nextItems: items,
				previousCheckpoint: { notices: [{ notice_type: "5", last_released_notice_id: 10 }] },
				previousItems: structuredClone(items),
			}),
		).toBe(false);
	});
});

function item(itemId: string, suffix: string): IngestionOfflineReleaseItem {
	return {
		artifacts: [{ ...artifact, uri: `s3://derived/${itemId}/${suffix}.json` }],
		item_id: itemId,
		version_id: `sha256:${suffix.repeat(64)}`,
	};
}
