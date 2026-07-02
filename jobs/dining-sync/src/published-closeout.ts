import { Client } from "pg";

export interface DiningPublishedCloseoutPgClient {
	connect(): Promise<unknown>;
	end(): Promise<unknown>;
	query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type DiningPublishedCloseoutPgClientFactory = () => DiningPublishedCloseoutPgClient;

export interface DiningPublishedCloseoutSummary {
	halls: Array<{
		floorCount: number;
		hallId: string;
		name: string;
		placeholderFloorCount: number;
	}>;
	releaseId: string;
	reviewCount: number;
	status: "published_snapshot_ready";
	totalFloorCount: number;
	totalMenuOfferingCount: number;
	totalWindowCount: number;
	updatedAt: string;
}

export class PostgresDiningPublishedCloseoutVerifier {
	private readonly createClient: DiningPublishedCloseoutPgClientFactory;

	constructor(input: { databaseUrl: string } | { createClient: DiningPublishedCloseoutPgClientFactory }) {
		this.createClient =
			"createClient" in input
				? input.createClient
				: () => new Client({ connectionString: input.databaseUrl });
	}

	async verify(): Promise<DiningPublishedCloseoutSummary> {
		const client = this.createClient();
		await client.connect();
		try {
			return verifyPublishedDiningState(client);
		} finally {
			await client.end();
		}
	}
}

async function verifyPublishedDiningState(
	client: DiningPublishedCloseoutPgClient,
): Promise<DiningPublishedCloseoutSummary> {
	const snapshotResult = await client.query(`
    select lp.release_id, lp.updated_at, rs.payload_json
    from "dining"."release_latest_pointer" lp
    join "dining"."release_snapshots" rs on rs.release_id = lp.release_id
    where lp.scope = 'global'
    limit 1
  `);
	const snapshotRow = snapshotResult.rows[0];
	if (!snapshotRow) {
		throw new Error("Dining published closeout failed: latest published snapshot is missing.");
	}
	const snapshot = snapshotRow.payload_json;
	if (!isRecord(snapshot)) {
		throw new Error("Dining published closeout failed: snapshot payload is not an object.");
	}
	const halls = arrayOfRecords(snapshot.halls);
	if (halls.length === 0) {
		throw new Error("Dining published closeout failed: snapshot has no visible halls.");
	}
	const floors = isRecord(snapshot.floors) ? snapshot.floors : {};
	let totalFloorCount = 0;
	let totalMenuOfferingCount = 0;
	let totalWindowCount = 0;
	const visibleHalls = halls.map((hall) => {
		const hallId = requireString(hall.hallId, "hall.hallId");
		const name = requireString(hall.name, `hall ${hallId} name`);
		const hallFloors = arrayOfRecords(hall.floors);
		if (hallFloors.length === 0) {
			throw new Error(`Dining published closeout failed: hall has no floors: ${hallId}.`);
		}
		let placeholderFloorCount = 0;
		for (const floorSummary of hallFloors) {
			const floorId = requireString(floorSummary.floorId, `hall ${hallId} floorId`);
			const floor = floors[`${hallId}:${floorId}`];
			if (!isRecord(floor)) {
				throw new Error(
					`Dining published closeout failed: missing floor projection: ${hallId}/${floorId}.`,
				);
			}
			const floorRecord = requireRecord(floor.floor, `floor ${hallId}/${floorId} metadata`);
			const floorplan = requireRecord(
				floorRecord.floorplan,
				`floor ${hallId}/${floorId} floorplan`,
			);
			const floorplanId = requireString(
				floorplan.floorplanId,
				`floor ${hallId}/${floorId} floorplanId`,
			);
			if (floorplanId.startsWith("placeholder:")) {
				placeholderFloorCount += 1;
			}
			requireString(floorplan.sha256, `floor ${hallId}/${floorId} sha256`);
			const windows = arrayOfRecords(floor.windows);
			if (windows.length === 0) {
				throw new Error(
					`Dining published closeout failed: floor has no windows: ${hallId}/${floorId}.`,
				);
			}
			const assignments = arrayOfRecords(floor.assignments);
			if (assignments.length === 0) {
				throw new Error(
					`Dining published closeout failed: floor has no assigned stalls: ${hallId}/${floorId}.`,
				);
			}
			const windowIds = new Set(windows.map((window) => requireString(window.windowId, "windowId")));
			for (const assignment of assignments) {
				const windowId = requireString(assignment.windowId, "assignment windowId");
				if (!windowIds.has(windowId)) {
					throw new Error(
						`Dining published closeout failed: assignment references missing window: ${hallId}/${floorId}.`,
					);
				}
			}
			const assignmentIds = new Set(
				assignments.map((assignment) => requireString(assignment.assignmentId, "assignmentId")),
			);
			const offeringCount = arrayOfRecords(floor.menuOfferings).filter((offering) =>
				assignmentIds.has(requireString(offering.assignmentId, "offering assignmentId")),
			).length;
			if (offeringCount === 0) {
				throw new Error(
					`Dining published closeout failed: floor has no menu offerings: ${hallId}/${floorId}.`,
				);
			}
			totalFloorCount += 1;
			totalWindowCount += windows.length;
			totalMenuOfferingCount += offeringCount;
		}
		return {
			floorCount: hallFloors.length,
			hallId,
			name,
			placeholderFloorCount,
		};
	});

	const reviewCountResult = await client.query(
		'select count(*)::int as review_count from "dining"."review_projections"',
	);
	const reviewCount = Number(reviewCountResult.rows[0]?.review_count ?? 0);
	const unsafeImageResult = await client.query(`
    select review_id
    from "dining"."review_projections"
    where images_json::text ~* '(feishu|lark|file_token|fileToken|open-apis|tenant_access_token)'
    limit 1
  `);
	if (unsafeImageResult.rows.length > 0) {
		throw new Error(
			"Dining published closeout failed: review image projection contains source-provider tokens.",
		);
	}

	return {
		halls: visibleHalls,
		releaseId: requireString(snapshotRow.release_id, "releaseId"),
		reviewCount,
		status: "published_snapshot_ready",
		totalFloorCount,
		totalMenuOfferingCount,
		totalWindowCount,
		updatedAt: toIsoString(snapshotRow.updated_at),
	};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	throw new Error(`Dining published closeout failed: ${label} is missing.`);
}

function requireString(value: unknown, label: string): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw new Error(`Dining published closeout failed: ${label} is missing.`);
}

function toIsoString(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date.toISOString();
		}
	}
	throw new Error("Dining published closeout failed: latest pointer updated_at is invalid.");
}
