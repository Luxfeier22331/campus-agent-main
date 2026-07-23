import { z } from "zod";

import { DiningDomainError } from "./error.ts";
import { sha256Tag, stableJson } from "./hash.ts";
import type { DiningPublishedSnapshot } from "./types.ts";

export interface DiningPublishedOfferingBinding {
	hallId: string;
	offeringId: string;
	stallProfileId: string;
	windowId: string;
}

const nonEmptyText = z.string().trim().min(1);
const nullableText = z.string().nullable();

const floorplanSchema = z.discriminatedUnion("kind", [
	z.strictObject({ floorplanId: nonEmptyText, kind: z.literal("asset") }),
	z.strictObject({ floorplanId: nonEmptyText, kind: z.literal("placeholder") }),
]);

const hallSchema = z.strictObject({
	campus: nonEmptyText,
	floors: z.array(
		z.strictObject({ floorId: nonEmptyText, floorplan: floorplanSchema, label: nonEmptyText }),
	),
	hallId: nonEmptyText,
	name: nonEmptyText,
	status: z.literal("active"),
});

const windowSchema = z.strictObject({
	floorId: nonEmptyText,
	hallId: nonEmptyText,
	label: nonEmptyText,
	locationLabel: nonEmptyText,
	svgAnchorId: nullableText,
	status: z.enum(["active", "closed", "maintenance"]),
	tags: z.array(nonEmptyText),
	windowId: nonEmptyText,
});

const stallSchema = z.strictObject({
	displayName: nonEmptyText,
	stallProfileId: nonEmptyText,
	stallType: nonEmptyText,
	status: z.literal("active"),
	tags: z.array(nonEmptyText),
});

const assignmentSchema = z.strictObject({
	assignmentId: nonEmptyText,
	stallProfileId: nonEmptyText,
	status: z.literal("active"),
	windowId: nonEmptyText,
});

const menuItemSchema = z.strictObject({
	menuItemId: nonEmptyText,
	name: nonEmptyText,
	status: z.literal("active"),
	tags: z.array(nonEmptyText),
});

const offeringSchema = z.strictObject({
	assignmentId: nonEmptyText,
	menuItemId: nonEmptyText,
	offeringId: nonEmptyText,
	priceLabel: nullableText,
});

const floorSchema = z.strictObject({
	assignments: z.array(assignmentSchema),
	floor: z.strictObject({
		draftRevision: z.number().int().positive().optional(),
		floorId: nonEmptyText,
		floorplan: floorplanSchema,
		hallId: nonEmptyText,
		label: nonEmptyText,
	}),
	menuItems: z.array(menuItemSchema),
	menuOfferings: z.array(offeringSchema),
	stallProfiles: z.array(stallSchema),
	windows: z.array(windowSchema),
});

export const DiningPublishedSnapshotSchema = z.strictObject({
	floors: z.record(z.string(), floorSchema),
	halls: z.array(hallSchema),
	source: z.strictObject({
		label: nonEmptyText,
		releaseId: nonEmptyText,
		updatedAt: z.iso.datetime({ offset: true }),
	}),
});

export function parseDiningPublishedSnapshot(
	value: unknown,
	expected: { releaseId?: string; snapshotHash?: string } = {},
): DiningPublishedSnapshot {
	const parsed = DiningPublishedSnapshotSchema.safeParse(value);
	if (!parsed.success) {
		throwInvalidSnapshot("Published Dining release payload does not match its schema.");
	}
	const snapshot = parsed.data as DiningPublishedSnapshot;
	if (expected.releaseId && snapshot.source.releaseId !== expected.releaseId) {
		throwInvalidSnapshot("Published Dining release identity does not match its pointer.");
	}
	if (expected.snapshotHash && sha256Tag(stableJson(snapshot)) !== expected.snapshotHash) {
		throwInvalidSnapshot("Published Dining release hash does not match its payload.");
	}
	assertSnapshotReferences(snapshot);
	return snapshot;
}

export function resolveDiningPublishedOffering(
	snapshot: DiningPublishedSnapshot,
	offeringId: string,
): DiningPublishedOfferingBinding | null {
	for (const hall of snapshot.halls) {
		for (const floorRef of hall.floors) {
			const floor = snapshot.floors[`${hall.hallId}:${floorRef.floorId}`];
			const offering = floor?.menuOfferings.find((item) => item.offeringId === offeringId);
			if (!offering) {
				continue;
			}
			const assignment = floor.assignments.find(
				(item) => item.assignmentId === offering.assignmentId,
			);
			if (!assignment) {
				throwInvalidSnapshot(`Published Dining offering ${offeringId} has no assignment.`);
			}
			const diningWindow = floor.windows.find((item) => item.windowId === assignment.windowId);
			if (!diningWindow) {
				throwInvalidSnapshot(`Published Dining offering ${offeringId} has no window.`);
			}
			return {
				hallId: hall.hallId,
				offeringId,
				stallProfileId: assignment.stallProfileId,
				windowId: diningWindow.windowId,
			};
		}
	}
	return null;
}

function assertSnapshotReferences(snapshot: DiningPublishedSnapshot): void {
	const hallIds = uniqueIds(
		snapshot.halls.map((hall) => hall.hallId),
		"hall",
	);
	const globalOfferingIds = new Set<string>();
	const expectedFloorKeys = new Set<string>();
	for (const hall of snapshot.halls) {
		uniqueIds(
			hall.floors.map((floor) => floor.floorId),
			`floor in ${hall.hallId}`,
		);
		for (const floor of hall.floors) {
			const key = `${hall.hallId}:${floor.floorId}`;
			expectedFloorKeys.add(key);
			const projection = snapshot.floors[key];
			if (
				!projection ||
				projection.floor.hallId !== hall.hallId ||
				projection.floor.floorId !== floor.floorId ||
				projection.floor.floorplan.kind !== floor.floorplan.kind ||
				projection.floor.floorplan.floorplanId !== floor.floorplan.floorplanId
			) {
				throwInvalidSnapshot(`Published Dining floor ${key} is missing or inconsistent.`);
			}
		}
	}
	if (Object.keys(snapshot.floors).some((key) => !expectedFloorKeys.has(key))) {
		throwInvalidSnapshot("Published Dining release contains an unreferenced floor projection.");
	}
	for (const [key, floor] of Object.entries(snapshot.floors)) {
		if (!hallIds.has(floor.floor.hallId)) {
			throwInvalidSnapshot(`Published Dining floor ${key} references a missing hall.`);
		}
		const windows = uniqueIds(
			floor.windows.map((item) => item.windowId),
			`window in ${key}`,
		);
		const stalls = uniqueIds(
			floor.stallProfiles.map((item) => item.stallProfileId),
			`stall in ${key}`,
		);
		const assignments = uniqueIds(
			floor.assignments.map((item) => item.assignmentId),
			`assignment in ${key}`,
		);
		const menuItems = uniqueIds(
			floor.menuItems.map((item) => item.menuItemId),
			`menu item in ${key}`,
		);
		uniqueIds(
			floor.menuOfferings.map((item) => item.offeringId),
			`offering in ${key}`,
		);
		for (const window of floor.windows) {
			if (window.floorId !== floor.floor.floorId || window.hallId !== floor.floor.hallId) {
				throwInvalidSnapshot(`Published Dining window ${window.windowId} has an invalid floor.`);
			}
		}
		for (const assignment of floor.assignments) {
			if (!(windows.has(assignment.windowId) && stalls.has(assignment.stallProfileId))) {
				throwInvalidSnapshot(
					`Published Dining assignment ${assignment.assignmentId} has an invalid reference.`,
				);
			}
		}
		for (const offering of floor.menuOfferings) {
			if (globalOfferingIds.has(offering.offeringId)) {
				throwInvalidSnapshot(`Published Dining offering ${offering.offeringId} is duplicated.`);
			}
			globalOfferingIds.add(offering.offeringId);
			if (!(assignments.has(offering.assignmentId) && menuItems.has(offering.menuItemId))) {
				throwInvalidSnapshot(
					`Published Dining offering ${offering.offeringId} has an invalid reference.`,
				);
			}
		}
	}
}

function uniqueIds(values: string[], kind: string): Set<string> {
	const ids = new Set(values);
	if (ids.size !== values.length) {
		throwInvalidSnapshot(`Published Dining release contains a duplicate ${kind} id.`);
	}
	return ids;
}

function throwInvalidSnapshot(message: string): never {
	throw new DiningDomainError({
		code: "dining_published_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
