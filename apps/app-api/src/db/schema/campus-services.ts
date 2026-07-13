import {
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { CampusServicesTransportStatusResponse } from "../../modules/campus-services-transport-schedule";

const campusServices = pgSchema("campus_services");

export const transportReleases = campusServices.table(
	"transport_releases",
	{
		contentSha256: text("content_sha256").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
		effectiveUntil: date("effective_until", { mode: "string" }),
		publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
		releaseId: text("release_id").primaryKey(),
		sourceUrlsJson: jsonb("source_urls_json").$type<string[]>().notNull(),
		statusJson: jsonb("status_json").$type<CampusServicesTransportStatusResponse>().notNull(),
	},
	(table) => ({
		contentSha256Unique: uniqueIndex("campus_services_transport_releases_content_uidx").on(
			table.contentSha256,
		),
		publishedAtIndex: index("campus_services_transport_releases_published_idx").on(
			table.publishedAt,
		),
	}),
);

export const transportCurrent = campusServices.table("transport_current", {
	pointerKey: text("pointer_key").primaryKey(),
	releaseId: text("release_id")
		.notNull()
		.references(() => transportReleases.releaseId),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const transportRoutes = campusServices.table(
	"transport_routes",
	{
		aliasesJson: jsonb("aliases_json").$type<string[]>().notNull().default([]),
		destinationCampus: text("destination_campus").notNull(),
		destinationStopId: text("destination_stop_id").notNull(),
		destinationStopName: text("destination_stop_name").notNull(),
		displayName: text("display_name").notNull(),
		originCampus: text("origin_campus").notNull(),
		originStopId: text("origin_stop_id").notNull(),
		originStopName: text("origin_stop_name").notNull(),
		releaseId: text("release_id")
			.notNull()
			.references(() => transportReleases.releaseId),
		routeId: text("route_id").notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => ({
		primaryKey: primaryKey({ columns: [table.releaseId, table.routeId] }),
		releaseSortIndex: index("campus_services_transport_routes_release_sort_idx").on(
			table.releaseId,
			table.sortOrder,
		),
	}),
);

export const transportDepartures = campusServices.table(
	"transport_departures",
	{
		departureId: text("departure_id").notNull(),
		departureKind: text("departure_kind").notNull(),
		departureTime: text("departure_time").notNull(),
		effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
		effectiveUntil: date("effective_until", { mode: "string" }),
		note: text("note"),
		releaseId: text("release_id")
			.notNull()
			.references(() => transportReleases.releaseId),
		routeId: text("route_id").notNull(),
		serviceDate: date("service_date", { mode: "string" }),
		serviceMode: text("service_mode").notNull(),
		sortOrder: integer("sort_order").notNull(),
		sourceUrlsJson: jsonb("source_urls_json").$type<string[]>().notNull(),
		status: text("status").notNull(),
	},
	(table) => ({
		releaseRouteForeignKey: foreignKey({
			columns: [table.releaseId, table.routeId],
			foreignColumns: [transportRoutes.releaseId, transportRoutes.routeId],
		}),
		primaryKey: primaryKey({ columns: [table.releaseId, table.departureId] }),
		releaseRouteSortIndex: index("campus_services_transport_departures_route_sort_idx").on(
			table.releaseId,
			table.routeId,
			table.sortOrder,
		),
	}),
);
