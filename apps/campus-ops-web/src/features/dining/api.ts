import { appApiJson } from "@/platform/app-api/client";
import type {
	DiningAuditEvent,
	DiningMenuItem,
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningRelease,
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
	tags?: string[];
	windowId: string;
}) {
	return appApiJson<{ window: DiningWindow }>({
		body: {
			geometry: input.geometry,
			label: input.label,
			locationLabel: input.locationLabel,
			status: input.status,
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

export function publishDiningRelease(input: { notes: string }) {
	return appApiJson<{ release: DiningRelease }>({
		body: input,
		method: "POST",
		path: "/api/ops/dining/releases",
	});
}

export function listDiningReleases() {
	return appApiJson<{ releases: DiningRelease[] }>({ path: "/api/ops/dining/releases" });
}

export function listDiningAuditEvents() {
	return appApiJson<{ events: DiningAuditEvent[] }>({ path: "/api/ops/dining/audit-events" });
}
