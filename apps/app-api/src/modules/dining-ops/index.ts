import { AppApiRouteError } from "../../http";
import { DINING_HALL_SEEDS, DINING_SOURCE } from "../campus-experience";
import {
	definedFields,
	requireAssignment,
	requireMenuItem,
	requireMenuOffering,
	requireStallProfile,
	requireWindow,
} from "./guards";

export { createPgDiningOperationsStore, ensureInitialDiningOperationsRelease } from "./store";

export type DiningWindowStatus = "active" | "closed" | "maintenance";
export type DiningSaleStatus = "available" | "paused" | "seasonal" | "removed";
export type DiningReleaseStatus = "draft" | "published";

export interface DiningOpsActor {
	displayName: string;
	principalId: string;
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
	status: DiningWindowStatus;
	tags: string[];
	windowId: string;
}

export interface DiningStallProfile {
	displayName: string;
	stallProfileId: string;
	stallType: string;
	status: "active";
	tags: string[];
}

export interface DiningWindowAssignment {
	assignmentId: string;
	stallProfileId: string;
	status: "active";
	windowId: string;
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
	saleStatus: DiningSaleStatus;
	specLabel: string | null;
}

export interface DiningAuditEvent {
	action: string;
	actorDisplayName: string;
	actorPrincipalId: string;
	after: Record<string, unknown> | null;
	auditEventId: string;
	before: Record<string, unknown> | null;
	objectId: string;
	objectKind: string;
	occurredAt: string;
}

export interface DiningRelease {
	createdAt: string;
	createdBy: string;
	notes: string;
	publishedAt: string | null;
	publishedBy: string | null;
	releaseId: string;
	status: DiningReleaseStatus;
}

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

export interface DiningOpsFloorResponse {
	assignments: DiningWindowAssignment[];
	floor: {
		floorId: string;
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningPublishedSnapshot {
	halls: DiningOpsHall[];
	floors: Record<string, DiningOpsFloorResponse>;
	source: {
		label: string;
		updatedAt: string;
	};
}

export interface DiningOperationsState {
	auditEvents: DiningAuditEvent[];
	assignments: DiningWindowAssignment[];
	halls: DiningOpsHall[];
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	publishedRelease: DiningRelease | null;
	publishedSnapshot: DiningPublishedSnapshot | null;
	releaseSnapshots: Record<string, DiningPublishedSnapshot>;
	releases: DiningRelease[];
	stallProfiles: DiningStallProfile[];
	windows: DiningWindow[];
}

export interface DiningOperationsStore {
	getState(): Promise<DiningOperationsState>;
	saveState(state: DiningOperationsState): Promise<void>;
}

export interface DiningOperationsService {
	assignWindow(input: {
		actor: DiningOpsActor;
		input: {
			stallProfile: {
				displayName: string;
				stallType: string;
				tags: string[];
			};
			windowId: string;
		};
	}): Promise<{ assignment: DiningWindowAssignment; stallProfile: DiningStallProfile }>;
	createMenuItem(input: {
		actor: DiningOpsActor;
		input: { name: string; tags: string[] };
	}): Promise<{ menuItem: DiningMenuItem }>;
	createMenuOffering(input: {
		actor: DiningOpsActor;
		input: {
			assignmentId: string;
			menuItemId: string;
			priceLabel: string;
			saleStatus: DiningSaleStatus;
			specLabel: string | null;
		};
	}): Promise<{ offering: DiningMenuOffering }>;
	getFloor(input: { floorId: string; hallId: string }): Promise<DiningOpsFloorResponse>;
	getPublishedFloor(input: { floorId: string; hallId: string }): Promise<{
		floor: { floorId: string; hallId: string; label: string; svgAssetUrl: string };
		source: { label: string; updatedAt: string };
		stalls: Array<{
			id: string;
			locationLabel: string;
			name: string;
			priceLabel: string;
			tags: string[];
		}>;
	}>;
	getPublishedHalls(): Promise<{
		halls: Array<{
			campus: string;
			floors: Array<{ floorId: string; label: string }>;
			hallId: string;
			name: string;
		}>;
	}>;
	listAuditEvents(): Promise<{ events: DiningAuditEvent[] }>;
	listHalls(): Promise<{ halls: DiningOpsHall[] }>;
	listReleases(): Promise<{ releases: DiningRelease[] }>;
	previewRelease(input: { actor: DiningOpsActor; input: { notes: string } }): Promise<{
		preview: DiningPublishedSnapshot;
		summary: { changedWindowCount: number; hallCount: number };
	}>;
	publishRelease(input: {
		actor: DiningOpsActor;
		input: { notes: string };
	}): Promise<{ release: DiningRelease; snapshot: DiningPublishedSnapshot }>;
	updateMenuItem(input: {
		actor: DiningOpsActor;
		input: { name?: string; status?: "active"; tags?: string[] };
		menuItemId: string;
	}): Promise<{ menuItem: DiningMenuItem }>;
	updateMenuOffering(input: {
		actor: DiningOpsActor;
		input: { priceLabel?: string; saleStatus?: DiningSaleStatus; specLabel?: string | null };
		offeringId: string;
	}): Promise<{ offering: DiningMenuOffering }>;
	updateWindow(input: {
		actor: DiningOpsActor;
		input: Partial<Pick<DiningWindow, "geometry" | "label" | "locationLabel" | "status" | "tags">>;
		windowId: string;
	}): Promise<{ window: DiningWindow }>;
	updateWindowAssignment(input: {
		actor: DiningOpsActor;
		assignmentId: string;
		input: {
			stallProfile?: {
				displayName: string;
				stallType: string;
				tags: string[];
			};
			status?: "active";
		};
	}): Promise<{ assignment: DiningWindowAssignment; stallProfile: DiningStallProfile }>;
}

export function createInMemoryDiningOperationsStore(
	initialState: DiningOperationsState = createInitialDiningOperationsState(),
): DiningOperationsStore {
	let state = cloneState(initialState);
	return {
		async getState() {
			return cloneState(state);
		},
		async saveState(nextState) {
			state = cloneState(nextState);
		},
	};
}

let processStore: DiningOperationsStore | null = null;

export function createProcessDiningOperationsStore(): DiningOperationsStore {
	if (!processStore) {
		processStore = createInMemoryDiningOperationsStore();
	}
	return processStore;
}

export function buildDiningOperationsService(input: {
	store: DiningOperationsStore;
}): DiningOperationsService {
	return {
		async assignWindow({ actor, input: assignmentInput }) {
			const state = await input.store.getState();
			const window = requireWindow(state, assignmentInput.windowId);
			const stallProfile: DiningStallProfile = {
				displayName: assignmentInput.stallProfile.displayName,
				stallProfileId: `stall:${assignmentInput.windowId}`,
				stallType: assignmentInput.stallProfile.stallType,
				status: "active",
				tags: assignmentInput.stallProfile.tags,
			};
			const assignment: DiningWindowAssignment = {
				assignmentId: `assignment:${window.hallId}:${window.floorId}:${window.windowId}`,
				stallProfileId: stallProfile.stallProfileId,
				status: "active",
				windowId: window.windowId,
			};

			state.stallProfiles = upsertById(state.stallProfiles, "stallProfileId", stallProfile);
			state.assignments = upsertById(state.assignments, "assignmentId", assignment);
			state.auditEvents.push(
				createAuditEvent({
					action: "window_assignment.upserted",
					actor,
					after: toJsonRecord(assignment),
					before: null,
					objectId: assignment.assignmentId,
					objectKind: "dining.window_assignment",
				}),
			);
			await input.store.saveState(state);
			return { assignment, stallProfile };
		},
		async createMenuItem({ actor, input: menuInput }) {
			const state = await input.store.getState();
			const menuItem: DiningMenuItem = {
				menuItemId: `menu:${stableId(menuInput.name)}:${state.menuItems.length + 1}`,
				name: menuInput.name,
				status: "active",
				tags: menuInput.tags,
			};
			state.menuItems.push(menuItem);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_item.created",
					actor,
					after: toJsonRecord(menuItem),
					before: null,
					objectId: menuItem.menuItemId,
					objectKind: "dining.menu_item",
				}),
			);
			await input.store.saveState(state);
			return { menuItem };
		},
		async createMenuOffering({ actor, input: offeringInput }) {
			const state = await input.store.getState();
			const assignment = requireAssignment(state, offeringInput.assignmentId);
			const menuItem = requireMenuItem(state, offeringInput.menuItemId);
			const offering: DiningMenuOffering = {
				assignmentId: assignment.assignmentId,
				menuItemId: menuItem.menuItemId,
				offeringId: `offering:${assignment.assignmentId}:${menuItem.menuItemId}`,
				priceLabel: offeringInput.priceLabel,
				saleStatus: offeringInput.saleStatus,
				specLabel: offeringInput.specLabel,
			};
			if (state.menuOfferings.some((item) => item.offeringId === offering.offeringId)) {
				throw new AppApiRouteError({
					code: "dining_menu_offering_conflict",
					message: "Dining menu offering already exists.",
					retryable: false,
					status: 409,
				});
			}
			state.menuOfferings.push(offering);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_offering.created",
					actor,
					after: toJsonRecord(offering),
					before: null,
					objectId: offering.offeringId,
					objectKind: "dining.menu_offering",
				}),
			);
			await input.store.saveState(state);
			return { offering };
		},
		async getFloor(floorInput) {
			const state = await input.store.getState();
			return buildFloorResponse(state, floorInput);
		},
		async getPublishedFloor(floorInput) {
			const state = await input.store.getState();
			if (!state.publishedSnapshot) {
				throw new AppApiRouteError({
					code: "dining_release_not_published",
					message: "Published dining projection is not available.",
					retryable: false,
					status: 404,
				});
			}
			const floor = state.publishedSnapshot.floors[floorKey(floorInput)];
			if (!floor) {
				throw new AppApiRouteError({
					code: "dining_floor_not_found",
					message: "Dining floor projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			return toPublicFloor(floor, state.publishedSnapshot.source);
		},
		async getPublishedHalls() {
			const state = await input.store.getState();
			if (!state.publishedSnapshot) {
				return { halls: [] };
			}
			return {
				halls: state.publishedSnapshot.halls.map((hall) => ({
					campus: hall.campus,
					floors: hall.floors.map((floor) => ({
						floorId: floor.floorId,
						label: floor.label,
					})),
					hallId: hall.hallId,
					name: hall.name,
				})),
			};
		},
		async listAuditEvents() {
			const state = await input.store.getState();
			return { events: [...state.auditEvents].reverse() };
		},
		async listHalls() {
			const state = await input.store.getState();
			return { halls: state.halls };
		},
		async listReleases() {
			const state = await input.store.getState();
			return { releases: [...state.releases].reverse() };
		},
		async previewRelease() {
			const state = await input.store.getState();
			const preview = buildPublishedSnapshot(state);
			return {
				preview,
				summary: {
					changedWindowCount: state.windows.length,
					hallCount: state.halls.length,
				},
			};
		},
		async publishRelease({ actor, input: releaseInput }) {
			const state = await input.store.getState();
			const now = new Date().toISOString();
			const release: DiningRelease = {
				createdAt: now,
				createdBy: actor.principalId,
				notes: releaseInput.notes,
				publishedAt: now,
				publishedBy: actor.principalId,
				releaseId: `dining_release:${Date.parse(now).toString(36)}:${state.releases.length + 1}`,
				status: "published",
			};
			const snapshot = buildPublishedSnapshot(state);
			state.publishedRelease = release;
			state.publishedSnapshot = snapshot;
			state.releaseSnapshots[release.releaseId] = snapshot;
			state.releases.push(release);
			state.auditEvents.push(
				createAuditEvent({
					action: "release.published",
					actor,
					after: toJsonRecord(release),
					before: null,
					objectId: release.releaseId,
					objectKind: "dining.release",
				}),
			);
			await input.store.saveState(state);
			return { release, snapshot };
		},
		async updateMenuItem({ actor, input: menuInput, menuItemId }) {
			const state = await input.store.getState();
			const before = requireMenuItem(state, menuItemId);
			const menuItem = {
				...before,
				...definedFields(menuInput),
			};
			state.menuItems = upsertById(state.menuItems, "menuItemId", menuItem);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_item.updated",
					actor,
					after: toJsonRecord(menuItem),
					before: toJsonRecord(before),
					objectId: menuItem.menuItemId,
					objectKind: "dining.menu_item",
				}),
			);
			await input.store.saveState(state);
			return { menuItem };
		},
		async updateMenuOffering({ actor, input: offeringInput, offeringId }) {
			const state = await input.store.getState();
			const before = requireMenuOffering(state, offeringId);
			const offering = {
				...before,
				...definedFields(offeringInput),
			};
			state.menuOfferings = upsertById(state.menuOfferings, "offeringId", offering);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_offering.updated",
					actor,
					after: toJsonRecord(offering),
					before: toJsonRecord(before),
					objectId: offering.offeringId,
					objectKind: "dining.menu_offering",
				}),
			);
			await input.store.saveState(state);
			return { offering };
		},
		async updateWindow({ actor, input: windowInput, windowId }) {
			const state = await input.store.getState();
			const before = requireWindow(state, windowId);
			const window = {
				...before,
				...definedFields(windowInput),
			};
			state.windows = upsertById(state.windows, "windowId", window);
			state.auditEvents.push(
				createAuditEvent({
					action: "window.updated",
					actor,
					after: toJsonRecord(window),
					before: toJsonRecord(before),
					objectId: window.windowId,
					objectKind: "dining.window",
				}),
			);
			await input.store.saveState(state);
			return { window };
		},
		async updateWindowAssignment({ actor, assignmentId, input: assignmentInput }) {
			const state = await input.store.getState();
			const beforeAssignment = requireAssignment(state, assignmentId);
			const beforeProfile = requireStallProfile(state, beforeAssignment.stallProfileId);
			const assignment = {
				...beforeAssignment,
				...definedFields({ status: assignmentInput.status }),
			};
			const stallProfile = assignmentInput.stallProfile
				? {
						...beforeProfile,
						...assignmentInput.stallProfile,
					}
				: beforeProfile;
			state.assignments = upsertById(state.assignments, "assignmentId", assignment);
			state.stallProfiles = upsertById(state.stallProfiles, "stallProfileId", stallProfile);
			state.auditEvents.push(
				createAuditEvent({
					action: "window_assignment.updated",
					actor,
					after: toJsonRecord({ assignment, stallProfile }),
					before: toJsonRecord({ assignment: beforeAssignment, stallProfile: beforeProfile }),
					objectId: assignment.assignmentId,
					objectKind: "dining.window_assignment",
				}),
			);
			await input.store.saveState(state);
			return { assignment, stallProfile };
		},
	};
}

export function createInitialDiningOperationsState(): DiningOperationsState {
	const halls = DINING_HALL_SEEDS.map((hall) => ({
		campus: hall.campus,
		floors: hall.floors.map((floor) => ({
			floorId: floor.floorId,
			label: floor.label,
			svgAssetUrl: `/assets/dining/${hall.hallId}-${floor.floorId}.svg`,
		})),
		hallId: hall.hallId,
		name: hall.name,
		status: "active" as const,
	}));
	const windows = DINING_HALL_SEEDS.flatMap((hall) =>
		hall.floors.flatMap((floor) =>
			floor.stalls.map((stall, index) => ({
				floorId: floor.floorId,
				geometry: windowGeometry(index),
				hallId: hall.hallId,
				label: stall.name,
				locationLabel: stall.locationLabel,
				status: "active" as const,
				tags: stall.tags,
				windowId: windowIdFor(hall.hallId, floor.floorId, index),
			})),
		),
	);
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const menuItems: DiningMenuItem[] = [];
	const menuOfferings: DiningMenuOffering[] = [];

	for (const hall of DINING_HALL_SEEDS) {
		for (const floor of hall.floors) {
			for (const [index, stall] of floor.stalls.entries()) {
				const windowId = windowIdFor(hall.hallId, floor.floorId, index);
				const assignmentId = `assignment:${hall.hallId}:${floor.floorId}:${windowId}`;
				const stallProfileId = `stall:${hall.hallId}:${floor.floorId}:${stall.id}`;
				const menuItemId = `menu:${hall.hallId}:${floor.floorId}:${stall.id}`;
				stallProfiles.push({
					displayName: stall.name,
					stallProfileId,
					stallType: "seeded_food_window",
					status: "active",
					tags: stall.tags,
				});
				assignments.push({
					assignmentId,
					stallProfileId,
					status: "active",
					windowId,
				});
				menuItems.push({
					menuItemId,
					name: stall.name,
					status: "active",
					tags: stall.tags,
				});
				menuOfferings.push({
					assignmentId,
					menuItemId,
					offeringId: `offering:${assignmentId}:${menuItemId}`,
					priceLabel: stall.priceLabel,
					saleStatus: "available",
					specLabel: null,
				});
			}
		}
	}

	const draft: DiningOperationsState = {
		auditEvents: [],
		assignments,
		halls,
		menuItems,
		menuOfferings,
		publishedRelease: null,
		publishedSnapshot: null,
		releaseSnapshots: {},
		releases: [],
		stallProfiles,
		windows,
	};
	const snapshot = buildPublishedSnapshot(draft);
	const release: DiningRelease = {
		createdAt: DINING_SOURCE.updatedAt,
		createdBy: "system:initial-dining-seed",
		notes: "初始化校园食堂发布数据",
		publishedAt: DINING_SOURCE.updatedAt,
		publishedBy: "system:initial-dining-seed",
		releaseId: "dining_release:initial",
		status: "published",
	};
	return {
		...draft,
		publishedRelease: release,
		publishedSnapshot: snapshot,
		releaseSnapshots: {
			[release.releaseId]: snapshot,
		},
		releases: [release],
	};
}

function toJsonRecord(value: unknown): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function buildPublishedSnapshot(state: DiningOperationsState): DiningPublishedSnapshot {
	const floors = Object.fromEntries(
		state.halls.flatMap((hall) =>
			hall.floors.map((floor) => {
				const key = floorKey({ floorId: floor.floorId, hallId: hall.hallId });
				return [
					key,
					buildFloorResponse(state, {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				];
			}),
		),
	);
	return {
		floors,
		halls: state.halls,
		source: DINING_SOURCE,
	};
}

function buildFloorResponse(
	state: DiningOperationsState,
	input: { floorId: string; hallId: string },
): DiningOpsFloorResponse {
	const hall = state.halls.find((item) => item.hallId === input.hallId);
	const floor = hall?.floors.find((item) => item.floorId === input.floorId);
	if (!(hall && floor)) {
		throw new AppApiRouteError({
			code: "dining_floor_not_found",
			message: "Dining floor projection was not found.",
			retryable: false,
			status: 404,
		});
	}
	const windows = state.windows.filter(
		(window) => window.hallId === input.hallId && window.floorId === input.floorId,
	);
	const windowIds = new Set(windows.map((window) => window.windowId));
	const assignments = state.assignments.filter((assignment) => windowIds.has(assignment.windowId));
	const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
	const stallProfileIds = new Set(assignments.map((assignment) => assignment.stallProfileId));
	const menuOfferings = state.menuOfferings.filter((offering) =>
		assignmentIds.has(offering.assignmentId),
	);
	const menuItemIds = new Set(menuOfferings.map((offering) => offering.menuItemId));
	return {
		assignments,
		floor: {
			floorId: floor.floorId,
			hallId: hall.hallId,
			label: `${hall.name}${floor.label}`,
			svgAssetUrl: floor.svgAssetUrl,
		},
		menuItems: state.menuItems.filter((item) => menuItemIds.has(item.menuItemId)),
		menuOfferings,
		stallProfiles: state.stallProfiles.filter((profile) =>
			stallProfileIds.has(profile.stallProfileId),
		),
		windows,
	};
}

function toPublicFloor(
	floor: DiningOpsFloorResponse,
	source: DiningPublishedSnapshot["source"],
): Awaited<ReturnType<DiningOperationsService["getPublishedFloor"]>> {
	return {
		floor: floor.floor,
		source,
		stalls: floor.windows.map((window) => {
			const assignment = floor.assignments.find((item) => item.windowId === window.windowId);
			const stall = assignment
				? floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
				: null;
			const offering = assignment
				? floor.menuOfferings.find((item) => item.assignmentId === assignment.assignmentId)
				: null;
			return {
				id: window.windowId,
				locationLabel: window.locationLabel,
				name: stall?.displayName ?? window.label,
				priceLabel: offering?.priceLabel ?? "未发布价格",
				tags: stall?.tags ?? window.tags,
			};
		}),
	};
}

function createAuditEvent(input: {
	action: string;
	actor: DiningOpsActor;
	after: Record<string, unknown> | null;
	before: Record<string, unknown> | null;
	objectId: string;
	objectKind: string;
}): DiningAuditEvent {
	const occurredAt = new Date().toISOString();
	return {
		action: input.action,
		actorDisplayName: input.actor.displayName,
		actorPrincipalId: input.actor.principalId,
		after: input.after,
		auditEventId: `dining_audit:${Date.parse(occurredAt).toString(36)}:${input.action}:${input.objectId}`,
		before: input.before,
		objectId: input.objectId,
		objectKind: input.objectKind,
		occurredAt,
	};
}

function floorKey(input: { floorId: string; hallId: string }): string {
	return `${input.hallId}:${input.floorId}`;
}

function stableId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "");
}

function upsertById<T, K extends keyof T>(items: T[], key: K, next: T): T[] {
	const index = items.findIndex((item) => item[key] === next[key]);
	if (index < 0) {
		return [...items, next];
	}
	return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function windowGeometry(index: number): DiningWindow["geometry"] {
	const column = index % 3;
	const row = Math.floor(index / 3);
	return {
		height: 72,
		width: 150,
		x: 64 + column * 180,
		y: 72 + row * 112,
	};
}

function windowIdFor(hallId: string, floorId: string, index: number): string {
	return `${hallId}:${floorId}:window-${String(index + 1).padStart(2, "0")}`;
}

function cloneState(state: DiningOperationsState): DiningOperationsState {
	return JSON.parse(JSON.stringify(state)) as DiningOperationsState;
}
