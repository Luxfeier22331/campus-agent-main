import type { NormalizedPageObservation } from "./service-types";
import type {
	OfficialWebPageChange,
	OfficialWebPageChangeStatus,
	OfficialWebRunIntent,
	PersistedOfficialWebPageObservation,
	StoredOfficialWebPageFreshnessState,
	StoredOfficialWebRun,
} from "./store";

function classifyPageObservation(input: {
	observation: NormalizedPageObservation;
	previous: StoredOfficialWebPageFreshnessState | null;
}): { changeStatus: OfficialWebPageChangeStatus; reason: string } {
	const { observation, previous } = input;
	if (observation.fetchDisposition === "fetch_failed") {
		return {
			changeStatus: "fetch_failed",
			reason:
				observation.httpStatus != null
					? `fetch_failed_http_${observation.httpStatus}`
					: "fetch_failed",
		};
	}
	if (
		observation.fetchDisposition === "deleted" ||
		observation.httpStatus === 404 ||
		observation.httpStatus === 410
	) {
		return {
			changeStatus: "deleted",
			reason: "page_deleted",
		};
	}
	if (observation.fetchDisposition === "not_modified") {
		return {
			changeStatus: "not_modified",
			reason: "conditional_not_modified",
		};
	}
	if (!previous) {
		return {
			changeStatus: "new",
			reason: "first_seen",
		};
	}
	if (previous.mainContentHash !== observation.mainContentHash) {
		return {
			changeStatus: "changed",
			reason: "main_content_changed",
		};
	}
	if (previous.responseBodyHash !== observation.responseBodyHash) {
		return {
			changeStatus: "not_modified",
			reason: "response_noise_only",
		};
	}
	return {
		changeStatus: "not_modified",
		reason: "not_modified",
	};
}

function deriveCadenceClass(input: {
	fetchDisposition: NormalizedPageObservation["fetchDisposition"];
	pageFamily: string;
	runIntent: OfficialWebRunIntent;
}): string {
	if (input.fetchDisposition === "fetch_failed" || input.runIntent === "repair") {
		return "repair";
	}
	if (input.pageFamily === "listing_page") {
		return "listing_hot";
	}
	if (input.runIntent === "hot" || input.pageFamily === "article_detail") {
		return "detail_recent";
	}
	return "baseline_static";
}

function derivePriorityScore(cadenceClass: string): number {
	switch (cadenceClass) {
		case "repair":
			return 95;
		case "listing_hot":
			return 90;
		case "detail_recent":
			return 75;
		default:
			return 40;
	}
}

function deriveNextEligibleFetchAt(input: { cadenceClass: string; observedAt: string }): string {
	const observedAtMs = new Date(input.observedAt).valueOf();
	const delayMs =
		input.cadenceClass === "repair"
			? 15 * 60 * 1000
			: input.cadenceClass === "listing_hot"
				? 30 * 60 * 1000
				: input.cadenceClass === "detail_recent"
					? 6 * 60 * 60 * 1000
					: 24 * 60 * 60 * 1000;
	return new Date(observedAtMs + delayMs).toISOString();
}

function deriveFreshnessState(input: {
	changeStatus: OfficialWebPageChangeStatus;
	observation: NormalizedPageObservation;
	previous: StoredOfficialWebPageFreshnessState | null;
	runId: string;
}): PersistedOfficialWebPageObservation["freshness"] {
	const { changeStatus, observation, previous, runId } = input;

	return {
		lastChangedAt:
			changeStatus === "new" || changeStatus === "changed" || changeStatus === "deleted"
				? observation.observedAt
				: (previous?.lastChangedAt ?? null),
		lastNotModifiedAt:
			changeStatus === "not_modified"
				? observation.observedAt
				: changeStatus === "fetch_failed"
					? (previous?.lastNotModifiedAt ?? null)
					: null,
		lastSuccessfulRunId:
			changeStatus === "deleted" || changeStatus === "fetch_failed"
				? (previous?.lastSuccessfulRunId ?? null)
				: runId,
		mainContentHash: observation.mainContentHash ?? previous?.mainContentHash ?? null,
		responseBodyHash: observation.responseBodyHash ?? previous?.responseBodyHash ?? null,
	};
}

export function buildPersistedPageObservations(input: {
	existingStates: Map<string, StoredOfficialWebPageFreshnessState>;
	generateId: (prefix: string) => string;
	pageObservations: NormalizedPageObservation[];
	run: StoredOfficialWebRun;
}): {
	observations: PersistedOfficialWebPageObservation[];
	pageChanges: OfficialWebPageChange[];
	summary: Record<string, number>;
} {
	const deduped = new Map<string, NormalizedPageObservation>();
	for (const observation of input.pageObservations) {
		deduped.set(observation.normalizedCanonicalUrl, observation);
	}

	const observations: PersistedOfficialWebPageObservation[] = [];
	const pageChanges: OfficialWebPageChange[] = [];
	const summary = {
		changedPages: 0,
		failedFetchPages: 0,
		deletedPages: 0,
		newPages: 0,
		notModifiedPages: 0,
	};

	for (const observation of deduped.values()) {
		const previous = input.existingStates.get(observation.normalizedCanonicalUrl) ?? null;
		const classified = classifyPageObservation({
			observation,
			previous,
		});
		const cadenceClass = deriveCadenceClass({
			fetchDisposition: observation.fetchDisposition,
			pageFamily: observation.pageFamily,
			runIntent: input.run.runIntent,
		});
		const priorityScore = derivePriorityScore(cadenceClass);
		const nextEligibleFetchAt = deriveNextEligibleFetchAt({
			cadenceClass,
			observedAt: observation.observedAt,
		});
		const freshness = deriveFreshnessState({
			changeStatus: classified.changeStatus,
			observation,
			previous,
			runId: input.run.runId,
		});

		if (classified.changeStatus === "new") {
			summary.newPages += 1;
		} else if (classified.changeStatus === "changed") {
			summary.changedPages += 1;
		} else if (classified.changeStatus === "deleted") {
			summary.deletedPages += 1;
		} else if (classified.changeStatus === "fetch_failed") {
			summary.failedFetchPages += 1;
		} else {
			summary.notModifiedPages += 1;
		}

		observations.push({
			cadenceClass,
			changeStatus: classified.changeStatus,
			contentType: observation.contentType,
			discoveredFromUrl: observation.discoveredFromUrl,
			discoveryMethod: observation.discoveryMethod,
			etag: observation.etag,
			fetchDisposition: observation.fetchDisposition,
			finalUrl: observation.finalUrl,
			host: observation.host,
			httpStatus: observation.httpStatus,
			lastChangeReason: classified.reason,
			lastModified: observation.lastModified,
			mainContentHash: observation.mainContentHash,
			nextEligibleFetchAt,
			normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
			observationId: input.generateId("owobs"),
			observedAt: observation.observedAt,
			pageFamily: observation.pageFamily,
			pageTitleNormalized: observation.pageTitleNormalized,
			priorityScore,
			rawAssetId: observation.rawAssetId,
			rawVersionId: observation.rawVersionId,
			requestedUrl: observation.requestedUrl,
			responseBodyHash: observation.responseBodyHash,
			runId: input.run.runId,
			runIntent: input.run.runIntent,
			siteId: input.run.siteId,
			freshness,
		});
		if (
			classified.changeStatus === "new" ||
			classified.changeStatus === "changed" ||
			classified.changeStatus === "deleted"
		) {
			pageChanges.push({
				changeStatus: classified.changeStatus,
				normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
				observedAt: observation.observedAt,
				pageFamily: observation.pageFamily,
				rawAssetId: observation.rawAssetId,
				rawVersionId: observation.rawVersionId,
			});
		}
	}

	return {
		observations,
		pageChanges,
		summary,
	};
}
