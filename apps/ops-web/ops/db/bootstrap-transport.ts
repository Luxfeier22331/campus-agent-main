import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { readDatabaseConnectionConfig } from "./postgres-tls.ts";
import { TRANSPORT_BASELINE_PERIODS, TRANSPORT_BASELINE_ROUTES } from "./transport-baseline.ts";

const BOOTSTRAP_ACTOR = "system:transport-baseline";

interface BootstrapDatabase {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
}

export interface TransportBootstrapResult {
	items: number;
	periods: number;
	routes: number;
	status: "already_initialized" | "initialized";
}

export async function bootstrapTransportSchedule(input: {
	database: BootstrapDatabase;
	now?: Date;
}): Promise<TransportBootstrapResult> {
	const inventory = await input.database.query(`
		select
			(select count(*) from transport.routes) as routes,
			(select count(*) from transport.schedule_periods) as periods,
			(select count(*) from transport.schedule_items) as items
	`);
	const row = inventory.rows[0];
	if (!row) {
		throw new Error("Transport bootstrap inventory query returned no row.");
	}
	const counts = {
		items: nonNegativeInteger(row.items, "items"),
		periods: nonNegativeInteger(row.periods, "periods"),
		routes: nonNegativeInteger(row.routes, "routes"),
	};
	if (Object.values(counts).some((value) => value > 0)) {
		return { ...counts, status: "already_initialized" };
	}

	const timestamp = (input.now ?? new Date()).toISOString();
	await input.database.query("BEGIN");
	try {
		for (const route of TRANSPORT_BASELINE_ROUTES) {
			await input.database.query(
				`insert into transport.routes
				 (route_id, origin, destination, service_kind, default_boarding_point,
				  display_order, created_at, updated_at, updated_by)
				 values ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
				[
					route.routeId,
					route.origin,
					route.destination,
					route.serviceKind,
					route.defaultBoardingPoint,
					route.displayOrder,
					timestamp,
					BOOTSTRAP_ACTOR,
				],
			);
		}

		let itemCount = 0;
		for (const period of TRANSPORT_BASELINE_PERIODS) {
			await input.database.query(
				`insert into transport.schedule_periods
				 (schedule_id, route_id, valid_from, valid_to, weekdays, status,
				  boarding_point_override, note, created_at, updated_at, updated_by)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)`,
				[
					period.scheduleId,
					period.input.routeId,
					period.input.validFrom,
					period.input.validTo,
					period.input.weekdays,
					period.input.status,
					period.input.boardingPointOverride,
					period.input.note,
					timestamp,
					BOOTSTRAP_ACTOR,
				],
			);
			for (const item of period.input.items) {
				await input.database.query(
					`insert into transport.schedule_items
					 (item_id, schedule_id, kind, boarding_point, departure_time,
					  first_departure_time, last_departure_time, interval_minutes,
					  rider_type, capacity, note, sort_order)
					 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
					[
						`${period.scheduleId}:${item.sortOrder}`,
						period.scheduleId,
						item.kind,
						item.boardingPoint,
						item.kind === "fixed" ? item.departureTime : null,
						item.kind === "interval" ? item.firstDepartureTime : null,
						item.kind === "interval" ? item.lastDepartureTime : null,
						item.kind === "interval" ? item.intervalMinutes : null,
						item.riderType,
						item.capacity,
						item.note,
						item.sortOrder,
					],
				);
				itemCount += 1;
			}
		}

		await input.database.query("COMMIT");
		return {
			items: itemCount,
			periods: TRANSPORT_BASELINE_PERIODS.length,
			routes: TRANSPORT_BASELINE_ROUTES.length,
			status: "initialized",
		};
	} catch (error) {
		await input.database.query("ROLLBACK");
		throw error;
	}
}

export async function bootstrapTransportScheduleFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<TransportBootstrapResult> {
	const config = readDatabaseConnectionConfig(env, {
		caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
		databaseUrl: "OPS_WEB_DATABASE_URL",
		sslMode: "OPS_WEB_DATABASE_SSLMODE",
	});
	const pool = new pg.Pool({ ...config, max: 1 });
	try {
		return await bootstrapTransportSchedule({ database: pool });
	} finally {
		await pool.end();
	}
}

function nonNegativeInteger(value: unknown, label: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`Transport bootstrap ${label} is invalid.`);
	}
	return parsed;
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await bootstrapTransportScheduleFromEnv(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
