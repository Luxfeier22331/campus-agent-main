import { Client, type ClientConfig, type QueryResult } from "pg";
import type { PreparedTransportPublication } from "./publication.ts";

export interface TransportPublisherDatabaseClient {
	connect(): Promise<unknown>;
	end(): Promise<void>;
	query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export type TransportPublisherDatabaseClientFactory = () => TransportPublisherDatabaseClient;

export interface TransportPublicationResult {
	contentSha256: string;
	departureCount: number;
	releaseId: string;
	routeCount: number;
}

export class PostgresTransportPublisher {
	private readonly createClient: () => TransportPublisherDatabaseClient;

	constructor(
		databaseConfig: ClientConfig,
		options: { createClient?: TransportPublisherDatabaseClientFactory } = {},
	) {
		this.createClient =
			options.createClient ?? (() => new Client(databaseConfig));
	}

	async publish(prepared: PreparedTransportPublication): Promise<TransportPublicationResult> {
		const client = this.createClient();
		const { publication } = prepared;
		const releaseId = publication.status.release.releaseId;
		await client.connect();
		try {
			await client.query("BEGIN");
			const release = await client.query(
				`INSERT INTO "campus_services"."transport_releases" (
					"release_id", "published_at", "effective_from", "effective_until",
					"source_urls_json", "status_json", "content_sha256", "created_at"
				) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
				ON CONFLICT ("release_id") DO UPDATE
				SET "release_id" = EXCLUDED."release_id"
				WHERE "campus_services"."transport_releases"."content_sha256" = EXCLUDED."content_sha256"
				RETURNING "release_id"`,
				[
					releaseId,
					publication.status.release.publishedAt,
					publication.effectiveFrom,
					publication.effectiveUntil,
					JSON.stringify(publication.status.release.sourceRefs),
					JSON.stringify(publication.status),
					prepared.contentSha256,
					new Date(),
				],
			);
			if (release.rowCount !== 1) {
				throw new Error(`release id already exists with different content: ${releaseId}`);
			}
			for (const route of prepared.routeRows) {
				await client.query(
					`INSERT INTO "campus_services"."transport_routes" (
						"release_id", "route_id", "display_name", "origin_campus",
						"destination_campus", "origin_stop_id", "origin_stop_name",
						"destination_stop_id", "destination_stop_name", "aliases_json", "sort_order"
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
					ON CONFLICT ("release_id", "route_id") DO NOTHING`,
					[
						releaseId,
						route.routeId,
						route.displayName,
						route.originCampus,
						route.destinationCampus,
						route.originStopId,
						route.originStopName,
						route.destinationStopId,
						route.destinationStopName,
						JSON.stringify(route.aliases),
						route.sortOrder,
					],
				);
			}
			for (const departure of prepared.departureRows) {
				await client.query(
					`INSERT INTO "campus_services"."transport_departures" (
						"release_id", "departure_id", "route_id", "service_mode", "service_date",
						"effective_from", "effective_until", "departure_time", "departure_kind",
						"status", "note", "source_urls_json", "sort_order"
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
					ON CONFLICT ("release_id", "departure_id") DO NOTHING`,
					[
						releaseId,
						departure.departureId,
						departure.routeId,
						departure.serviceMode,
						departure.serviceDate ?? null,
						departure.effectiveFrom,
						departure.effectiveUntil,
						departure.departureTime,
						departure.kind,
						departure.status,
						departure.note ?? null,
						JSON.stringify(departure.sourceRefs),
						departure.sortOrder,
					],
				);
			}
			const counts = await client.query(
				`SELECT
					(SELECT count(*)::integer FROM "campus_services"."transport_routes" WHERE "release_id" = $1) AS "route_count",
					(SELECT count(*)::integer FROM "campus_services"."transport_departures" WHERE "release_id" = $1) AS "departure_count"`,
				[releaseId],
			);
			const countRow = counts.rows[0] as
				| { departure_count?: number; route_count?: number }
				| undefined;
			if (
				countRow?.route_count !== prepared.routeRows.length ||
				countRow.departure_count !== prepared.departureRows.length
			) {
				throw new Error(`release rows do not match validated input: ${releaseId}`);
			}
			await client.query(
				`INSERT INTO "campus_services"."transport_current" ("pointer_key", "release_id", "updated_at")
				VALUES ('current', $1, $2)
				ON CONFLICT ("pointer_key") DO UPDATE
				SET "release_id" = EXCLUDED."release_id", "updated_at" = EXCLUDED."updated_at"`,
				[releaseId, new Date()],
			);
			await client.query("COMMIT");
			return {
				contentSha256: prepared.contentSha256,
				departureCount: prepared.departureRows.length,
				releaseId,
				routeCount: prepared.routeRows.length,
			};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			await client.end();
		}
	}
}
