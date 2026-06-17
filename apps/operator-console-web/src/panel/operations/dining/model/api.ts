import { appApiJson } from "./client";
import type {
	DiningAuditEvent,
	DiningMenuItem,
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningRelease,
	DiningReleaseCandidate,
	DiningReleaseCandidateEnvelope,
	DiningReleaseScheduleJob,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
} from "./model";

export function getDiningOpsHalls() {
	return appApiJson<{ halls: DiningOpsHall[] }>({ path: "/api/ops/dining/halls" });
}

export function getDiningOpsFloor(input: { floorId: string; hallId: string }) {
	return appApiJson<DiningOpsFloorResponse>({
		path: `/api/ops/dining/halls/${encodeURIComponent(input.hallId)}/floors/${encodeURIComponent(
			input.floorId,
		)}`,
	});
}

export function assignDiningWindow(input: {
	stallProfile: {
		displayName: string;
		stallType: string;
		tags: string[];
	};
	windowId: string;
}) {
	return appApiJson<{
		assignment: DiningWindowAssignment;
		stallProfile: DiningStallProfile;
	}>({
		body: input,
		method: "POST",
		path: "/api/ops/dining/window-assignments",
	});
}

export function updateDiningWindow(input: {
	geometry?: DiningWindow["geometry"];
	label?: string;
	locationLabel?: string;
	status?: DiningWindow["status"];
	svgAnchorId?: string | null;
	tags?: string[];
	windowId: string;
}) {
	return appApiJson<{ window: DiningWindow }>({
		body: {
			geometry: input.geometry,
			label: input.label,
			locationLabel: input.locationLabel,
			status: input.status,
			svgAnchorId: input.svgAnchorId,
			tags: input.tags,
		},
		method: "PATCH",
		path: `/api/ops/dining/windows/${encodeURIComponent(input.windowId)}`,
	});
}

export function createDiningMenuItem(input: { name: string; tags: string[] }) {
	return appApiJson<{ menuItem: DiningMenuItem }>({
		body: input,
		method: "POST",
		path: "/api/ops/dining/menu-items",
	});
}

export function updateDiningMenuItem(input: {
	menuItemId: string;
	name?: string;
	tags?: string[];
}) {
	return appApiJson<{ menuItem: DiningMenuItem }>({
		body: {
			name: input.name,
			tags: input.tags,
		},
		method: "PATCH",
		path: `/api/ops/dining/menu-items/${encodeURIComponent(input.menuItemId)}`,
	});
}

export function createDiningMenuOffering(input: {
	assignmentId: string;
	menuItemId: string;
	priceLabel: string;
	saleStatus: "available" | "paused" | "seasonal" | "removed";
	specLabel: string | null;
}) {
	return appApiJson<{ offering: DiningMenuOffering }>({
		body: input,
		method: "POST",
		path: "/api/ops/dining/menu-offerings",
	});
}

export function updateDiningMenuOffering(input: {
	offeringId: string;
	priceLabel?: string;
	saleStatus?: "available" | "paused" | "seasonal" | "removed";
	specLabel?: string | null;
}) {
	return appApiJson<{ offering: DiningMenuOffering }>({
		body: {
			priceLabel: input.priceLabel,
			saleStatus: input.saleStatus,
			specLabel: input.specLabel,
		},
		method: "PATCH",
		path: `/api/ops/dining/menu-offerings/${encodeURIComponent(input.offeringId)}`,
	});
}

export function createDiningReleaseCandidate(input: { notes: string }) {
	return appApiJson<DiningReleaseCandidateEnvelope>({
		body: input,
		method: "POST",
		path: "/api/ops/dining/release-candidates",
	});
}

export function listDiningReleaseCandidates() {
	return appApiJson<{ candidates: DiningReleaseCandidate[] }>({
		path: "/api/ops/dining/release-candidates",
	});
}

export function validateDiningReleaseCandidate(input: { candidateId: string }) {
	return appApiJson<DiningReleaseCandidateEnvelope>({
		method: "POST",
		path: `/api/ops/dining/release-candidates/${encodeURIComponent(input.candidateId)}/validate`,
	});
}

export function approveDiningReleaseCandidate(input: { candidateId: string; notes: string }) {
	return appApiJson<DiningReleaseCandidateEnvelope>({
		body: { notes: input.notes },
		method: "POST",
		path: `/api/ops/dining/release-candidates/${encodeURIComponent(input.candidateId)}/approve`,
	});
}

export function scheduleDiningReleaseCandidate(input: {
	candidateId: string;
	scheduledAt: string;
}) {
	return appApiJson<DiningReleaseCandidateEnvelope & { scheduleJob: DiningReleaseScheduleJob }>({
		body: { scheduledAt: input.scheduledAt },
		method: "POST",
		path: `/api/ops/dining/release-candidates/${encodeURIComponent(input.candidateId)}/schedule`,
	});
}

export function publishDiningReleaseCandidate(input: { candidateId: string }) {
	return appApiJson<{ release: DiningRelease }>({
		method: "POST",
		path: `/api/ops/dining/release-candidates/${encodeURIComponent(input.candidateId)}/publish`,
	});
}

export function cancelDiningReleaseCandidate(input: { candidateId: string }) {
	return appApiJson<DiningReleaseCandidateEnvelope>({
		method: "POST",
		path: `/api/ops/dining/release-candidates/${encodeURIComponent(input.candidateId)}/cancel`,
	});
}

export function listDiningReleases() {
	return appApiJson<{ releases: DiningRelease[] }>({ path: "/api/ops/dining/releases" });
}

export function getDiningRelease(input: { releaseId: string }) {
	return appApiJson<{ release: DiningRelease }>({
		path: `/api/ops/dining/releases/${encodeURIComponent(input.releaseId)}`,
	});
}

export function rollbackDiningRelease(input: { notes: string; releaseId: string }) {
	return appApiJson<{ release: DiningRelease }>({
		body: { mode: "latest_pointer", notes: input.notes },
		method: "POST",
		path: `/api/ops/dining/releases/${encodeURIComponent(input.releaseId)}/rollback`,
	});
}

export function listDiningAuditEvents() {
	return appApiJson<{ events: DiningAuditEvent[] }>({ path: "/api/ops/dining/audit-events" });
}
