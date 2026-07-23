import { describe, expect, it } from "vitest";
import {
	createDevDiningSeed,
	parseDiningPublishedSnapshot,
	resolveDiningPublishedOffering,
	sha256Tag,
	stableJson,
} from "../src/domain/index.ts";

describe("Dining published snapshot", () => {
	it("resolves an offering through its immutable assignment and window", () => {
		const seed = createDevDiningSeed();
		const floor = Object.values(seed.snapshot.floors)[0];
		const offering = floor?.menuOfferings[0];
		const assignment = floor?.assignments.find(
			(item) => item.assignmentId === offering?.assignmentId,
		);
		if (!(floor && offering && assignment)) {
			throw new Error("Dining dev seed must contain an offering.");
		}

		expect(resolveDiningPublishedOffering(seed.snapshot, offering.offeringId)).toEqual({
			hallId: floor.floor.hallId,
			offeringId: offering.offeringId,
			stallProfileId: assignment.stallProfileId,
			windowId: assignment.windowId,
		});
		expect(resolveDiningPublishedOffering(seed.snapshot, "offering:missing")).toBeNull();
	});

	it("rejects offering identifiers duplicated across published floors", () => {
		const seed = createDevDiningSeed();
		const floors = Object.values(seed.snapshot.floors);
		const first = floors[0]?.menuOfferings[0];
		const second = floors[1]?.menuOfferings[0];
		if (!(first && second)) {
			throw new Error("Dining dev seed must contain offerings on two floors.");
		}
		second.offeringId = first.offeringId;

		expect(() =>
			parseDiningPublishedSnapshot(seed.snapshot, {
				releaseId: seed.release.releaseId,
				snapshotHash: sha256Tag(stableJson(seed.snapshot)),
			}),
		).toThrow(/offering .* is duplicated/);
	});
});
