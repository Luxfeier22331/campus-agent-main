import { sql } from "drizzle-orm";
import { check, date, index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const transport = pgSchema("transport");

export const transportRoutes = transport.table(
	"routes",
	{
		boardingGuide: text("boarding_guide"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		defaultBoardingPoint: text("default_boarding_point"),
		dropOffPoint: text("drop_off_point"),
		destination: text("destination").notNull(),
		displayOrder: integer("display_order").notNull(),
		origin: text("origin").notNull(),
		routeId: text("route_id").primaryKey(),
		serviceKind: text("service_kind").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [
		check(
			"transport_routes_service_kind_check",
			sql`${table.serviceKind} in ('commute', 'subway', 'special')`,
		),
		check("transport_routes_display_order_check", sql`${table.displayOrder} >= 0`),
		index("transport_routes_display_idx").on(table.displayOrder, table.routeId),
	],
);

export const transportSchedulePeriods = transport.table(
	"schedule_periods",
	{
		boardingPointOverride: text("boarding_point_override"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		note: text("note"),
		routeId: text("route_id")
			.notNull()
			.references(() => transportRoutes.routeId, { onDelete: "cascade" }),
		scheduleId: text("schedule_id").primaryKey(),
		status: text("status").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
		validFrom: date("valid_from", { mode: "string" }).notNull(),
		validTo: date("valid_to", { mode: "string" }),
		weekdays: integer("weekdays").array().notNull(),
	},
	(table) => [
		check(
			"transport_schedule_periods_status_check",
			sql`${table.status} in ('operating', 'suspended')`,
		),
		check(
			"transport_schedule_periods_date_check",
			sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
		),
		check(
			"transport_schedule_periods_weekdays_check",
			sql`cardinality(${table.weekdays}) between 1 and 7`,
		),
		index("transport_schedule_periods_route_date_idx").on(
			table.routeId,
			table.validFrom,
			table.validTo,
			table.updatedAt,
		),
	],
);

export const transportScheduleItems = transport.table(
	"schedule_items",
	{
		boardingPoint: text("boarding_point"),
		capacity: integer("capacity"),
		departureTime: text("departure_time"),
		firstDepartureTime: text("first_departure_time"),
		intervalMinutes: integer("interval_minutes"),
		itemId: text("item_id").primaryKey(),
		kind: text("kind").notNull(),
		lastDepartureTime: text("last_departure_time"),
		note: text("note"),
		riderType: text("rider_type").notNull(),
		scheduleId: text("schedule_id")
			.notNull()
			.references(() => transportSchedulePeriods.scheduleId, { onDelete: "cascade" }),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => [
		check("transport_schedule_items_kind_check", sql`${table.kind} in ('fixed', 'interval')`),
		check(
			"transport_schedule_items_rider_type_check",
			sql`${table.riderType} in ('student', 'teacher', 'all')`,
		),
		check(
			"transport_schedule_items_capacity_check",
			sql`${table.capacity} is null or ${table.capacity} > 0`,
		),
		check("transport_schedule_items_sort_order_check", sql`${table.sortOrder} >= 0`),
		check(
			"transport_schedule_items_time_check",
			sql`(
				(${table.kind} = 'fixed'
					and ${table.departureTime} is not null
					and ${table.firstDepartureTime} is null
					and ${table.lastDepartureTime} is null
					and ${table.intervalMinutes} is null)
				or
				(${table.kind} = 'interval'
					and ${table.departureTime} is null
					and ${table.firstDepartureTime} is not null
					and ${table.lastDepartureTime} is not null
					and ${table.intervalMinutes} is not null)
			)`,
		),
		index("transport_schedule_items_schedule_sort_idx").on(
			table.scheduleId,
			table.sortOrder,
			table.itemId,
		),
	],
);
