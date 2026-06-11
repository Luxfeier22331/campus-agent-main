export interface DiningOpsHall {
	campus: string;
	floors: Array<{
		floorId: string;
		label: string;
		svgAssetUrl: string;
	}>;
	hallId: string;
	name: string;
	status: "active";
}

export interface DiningWindow {
	floorId: string;
	geometry: {
		height: number;
		width: number;
		x: number;
		y: number;
	};
	hallId: string;
	label: string;
	locationLabel: string;
	svgAnchorId?: string;
	status: "active" | "closed" | "maintenance";
	tags: string[];
	windowId: string;
}

export interface DiningWindowAssignment {
	assignmentId: string;
	stallProfileId: string;
	status: "active";
	windowId: string;
}

export interface DiningStallProfile {
	displayName: string;
	stallProfileId: string;
	stallType: string;
	status: "active";
	tags: string[];
}

export interface DiningMenuItem {
	menuItemId: string;
	name: string;
	status: "active";
	tags: string[];
}

export interface DiningMenuOffering {
	assignmentId: string;
	menuItemId: string;
	offeringId: string;
	priceLabel: string;
	saleStatus: "available" | "paused" | "seasonal" | "removed";
	specLabel: string | null;
}

export interface DiningOpsFloorResponse {
	assignments: DiningWindowAssignment[];
	floor: {
		floorId: string;
		hallId: string;
		label: string;
		svgMarkup?: string;
		svgAssetUrl: string;
	};
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningRelease {
	createdAt: string;
	createdBy: string;
	notes: string;
	publishedAt: string | null;
	publishedBy: string | null;
	releaseId: string;
	status: "draft" | "published";
}

export interface DiningAuditEvent {
	action: string;
	actorDisplayName: string;
	actorPrincipalId: string;
	auditEventId: string;
	objectId: string;
	objectKind: string;
	occurredAt: string;
}
