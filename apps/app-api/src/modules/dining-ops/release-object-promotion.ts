import { AppApiRouteError } from "../../http";
import {
	buildReleaseFloorplanObjectKey,
	buildReleaseSnapshotObjectKey,
	buildReleaseValidationReportObjectKey,
} from "./floorplan-assets";
import type { DiningFloorplanObjectStore } from "./floorplan-object-store";
import { sha256Tag, stableJson } from "./hash";
import { floorKey } from "./projection";
import type {
	DiningFloorplanRef,
	DiningReleaseCandidate,
	DiningReleaseCandidateValidationReport,
	DiningReleaseLatestPointer,
} from "./release-types";
import type { DiningPublishedSnapshot, DiningRelease } from "./types";

export async function promoteReleaseFloorplans(input: {
	objectStore?: DiningFloorplanObjectStore | null;
	published: {
		candidate: DiningReleaseCandidate;
		latestPointer: DiningReleaseLatestPointer;
		release: DiningRelease;
		snapshot: DiningPublishedSnapshot;
	};
	report: DiningReleaseCandidateValidationReport;
}): Promise<{
	candidate: DiningReleaseCandidate;
	latestPointer: DiningReleaseLatestPointer;
	release: DiningRelease;
	snapshot: DiningPublishedSnapshot;
}> {
	if (!input.objectStore) {
		throw new AppApiRouteError({
			code: "dining_floorplan_object_store_unavailable",
			message: "Dining floorplan object store is not configured.",
			retryable: false,
			status: 503,
		});
	}
	const releaseId = input.published.release.releaseId;
	const nextRefs: DiningFloorplanRef[] = [];
	const nextSnapshot = JSON.parse(
		JSON.stringify(input.published.snapshot),
	) as DiningPublishedSnapshot;
	for (const ref of input.published.candidate.floorplanRefs) {
		const digest = ref.sha256.replace(/^sha256:/, "");
		const targetObjectKey = buildReleaseFloorplanObjectKey({
			digest,
			floorId: ref.floorId,
			hallId: ref.hallId,
			releaseId,
		});
		const stored = await input.objectStore.copyObject({
			sha256: ref.sha256,
			sourceObjectKey: ref.objectKey,
			targetObjectKey,
		});
		const nextRef = {
			...ref,
			bucket: stored.bucket,
			byteSize: stored.byteSize,
			contentType: stored.contentType,
			objectKey: stored.objectKey,
		};
		nextRefs.push(nextRef);
		const floor = nextSnapshot.floors[floorKey(ref)];
		if (floor?.floor.floorplanAsset) {
			floor.floor.floorplanAsset = {
				...floor.floor.floorplanAsset,
				bucket: stored.bucket,
				byteSize: stored.byteSize,
				contentType: stored.contentType,
				objectKey: stored.objectKey,
			};
		}
	}
	const snapshotHash = sha256Tag(stableJson(nextSnapshot));
	const release = {
		...input.published.release,
		snapshotHash,
	};
	const candidate = {
		...input.published.candidate,
		floorplanRefs: nextRefs,
		snapshotHash,
	};
	await input.objectStore.putJson({
		objectKey: buildReleaseSnapshotObjectKey(releaseId),
		value: nextSnapshot,
	});
	await input.objectStore.putJson({
		objectKey: buildReleaseValidationReportObjectKey(releaseId),
		value: input.report,
	});
	return {
		candidate,
		latestPointer: input.published.latestPointer,
		release,
		snapshot: nextSnapshot,
	};
}
