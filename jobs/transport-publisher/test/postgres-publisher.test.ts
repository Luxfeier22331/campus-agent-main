import type { FieldDef, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
	PostgresTransportPublisher,
	type TransportPublisherDatabaseClient,
} from "../src/postgres-publisher";
import { prepareTransportPublication } from "../src/publication";

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
	return {
		command: "",
		fields: [] as FieldDef[],
		oid: 0,
		rowCount,
		rows,
	};
}

function preparedPublication() {
	return prepareTransportPublication({
		effectiveFrom: "2026-03-20",
		routes: [
			{
				aliases: [],
				destinationCampus: "fengtai",
				destinationStopId: "stop:fengtai-main-gate",
				destinationStopName: "丰台南门",
				originCampus: "haidian",
				originStopId: "stop:haidian-east-gate",
				originStopName: "海淀东门",
				routeId: "route:haidian-to-fengtai",
			},
		],
		status: {
			groups: [
				{
					kind: "weekday",
					routes: [
						{
							departures: [
								{
									departureTime: "07:30",
									kind: "student",
									sourceRefs: ["https://portal.example.edu/notice/355122"],
									status: "normal",
								},
							],
							displayName: "海淀到丰台",
							routeId: "route:haidian-to-fengtai",
						},
					],
				},
			],
			release: {
				publishedAt: "2026-03-19T16:00:00+08:00",
				releaseId: "transport:355122:2026-03-20",
				sourceRefs: ["https://portal.example.edu/notice/355122"],
			},
		},
	});
}

function fakeClient(options: { failDeparture?: boolean } = {}) {
	const queries: Array<{ text: string; values?: unknown[] }> = [];
	const client: TransportPublisherDatabaseClient = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		query: vi.fn(async (text: string, values?: unknown[]) => {
			queries.push({ text, values });
			if (options.failDeparture && text.includes('"transport_departures"')) {
				throw new Error("departure insert failed");
			}
			if (text.includes("RETURNING")) {
				return queryResult([{ release_id: "transport:355122:2026-03-20" }], 1);
			}
			if (text.includes("route_count")) {
				return queryResult([{ departure_count: 1, route_count: 1 }], 1);
			}
			return queryResult([], 0);
		}),
	};
	return { client, queries };
}

describe("PostgresTransportPublisher", () => {
	it("moves the current pointer only after all release rows are verified", async () => {
		const { client, queries } = fakeClient();
		const publisher = new PostgresTransportPublisher({ connectionString: "postgres://unused" }, {
			createClient: () => client,
		});

		const result = await publisher.publish(preparedPublication());

		expect(result).toMatchObject({ departureCount: 1, routeCount: 1 });
		const statements = queries.map((query) => query.text);
		const countIndex = statements.findIndex((text) => text.includes("route_count"));
		const pointerIndex = statements.findIndex((text) => text.includes('"transport_current"'));
		expect(pointerIndex).toBeGreaterThan(countIndex);
		expect(statements.at(-1)).toBe("COMMIT");
	});

	it("rolls back without moving the pointer when a typed row fails", async () => {
		const { client, queries } = fakeClient({ failDeparture: true });
		const publisher = new PostgresTransportPublisher({ connectionString: "postgres://unused" }, {
			createClient: () => client,
		});

		await expect(publisher.publish(preparedPublication())).rejects.toThrow(
			/departure insert failed/u,
		);

		const statements = queries.map((query) => query.text);
		expect(statements).toContain("ROLLBACK");
		expect(statements.some((text) => text.includes('"transport_current"'))).toBe(false);
	});
});
