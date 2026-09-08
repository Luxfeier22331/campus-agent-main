import { z } from "zod";

export const TRANSPORT_SERVICE_KINDS = ["commute", "subway", "special"] as const;
export const TRANSPORT_SCHEDULE_STATUSES = ["operating", "suspended"] as const;
export const TRANSPORT_RIDER_TYPES = ["student", "teacher", "all"] as const;
export const TRANSPORT_SCHEDULE_ITEM_KINDS = ["fixed", "interval"] as const;

const Identifier = z.string().trim().min(1).max(200);
const Text = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) => Text(max).nullable();
const IsoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/u, "日期必须为 YYYY-MM-DD")
	.refine(isValidIsoDate, "日期无效");
const CanonicalTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "时间必须为 HH:MM");
const Weekdays = z
	.array(z.number().int().min(1).max(7))
	.min(1)
	.max(7)
	.superRefine((values, context) => {
		if (new Set(values).size !== values.length) {
			context.addIssue({ code: "custom", message: "星期不能重复" });
		}
	});
const PositiveInt = z.number().int().positive().max(10_000).nullable();

export const TransportServiceKindSchema = z.enum(TRANSPORT_SERVICE_KINDS);
export const TransportScheduleStatusSchema = z.enum(TRANSPORT_SCHEDULE_STATUSES);
export const TransportRiderTypeSchema = z.enum(TRANSPORT_RIDER_TYPES);

const FixedScheduleItemSchema = z
	.object({
		boardingPoint: OptionalText(500),
		capacity: PositiveInt,
		departureTime: CanonicalTime,
		kind: z.literal("fixed"),
		note: OptionalText(1_000),
		riderType: TransportRiderTypeSchema,
		sortOrder: z.number().int().nonnegative(),
	})
	.strict();

const IntervalScheduleItemSchema = z
	.object({
		boardingPoint: OptionalText(500),
		capacity: PositiveInt,
		firstDepartureTime: CanonicalTime,
		intervalMinutes: z.number().int().positive().max(1_440),
		kind: z.literal("interval"),
		lastDepartureTime: CanonicalTime,
		note: OptionalText(1_000),
		riderType: TransportRiderTypeSchema,
		sortOrder: z.number().int().nonnegative(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.firstDepartureTime > value.lastDepartureTime) {
			context.addIssue({
				code: "custom",
				message: "首班时间不能晚于末班时间",
				path: ["lastDepartureTime"],
			});
		}
	});

export const TransportScheduleItemSchema = z.discriminatedUnion("kind", [
	FixedScheduleItemSchema,
	IntervalScheduleItemSchema,
]);

export const TransportSchedulePeriodInputSchema = z
	.object({
		boardingPointOverride: OptionalText(500),
		items: z.array(TransportScheduleItemSchema).max(2_000),
		note: OptionalText(1_000),
		routeId: Identifier,
		status: TransportScheduleStatusSchema,
		validFrom: IsoDate,
		validTo: IsoDate.nullable(),
		weekdays: Weekdays,
	})
	.strict()
	.superRefine((value, context) => {
		if (value.validTo !== null && value.validFrom > value.validTo) {
			context.addIssue({
				code: "custom",
				message: "结束日期不能早于开始日期",
				path: ["validTo"],
			});
		}
		if (value.status === "operating" && value.items.length === 0) {
			context.addIssue({
				code: "custom",
				message: "运行中的班次必须至少包含一条班次明细",
				path: ["items"],
			});
		}
		if (value.status === "suspended" && value.items.length > 0) {
			context.addIssue({
				code: "custom",
				message: "停运期间不能包含班次明细",
				path: ["items"],
			});
		}
	});

export const TransportRouteInputSchema = z
	.object({
		defaultBoardingPoint: OptionalText(500),
		destination: Text(500),
		displayOrder: z.number().int().nonnegative(),
		origin: Text(500),
		routeId: Identifier,
		serviceKind: TransportServiceKindSchema,
	})
	.strict();

const PublicFixedDepartureSchema = z
	.object({
		boardingPoint: OptionalText(500),
		capacity: PositiveInt,
		departureTime: CanonicalTime,
		kind: z.literal("fixed"),
		note: OptionalText(1_000),
		riderType: TransportRiderTypeSchema,
	})
	.strict();

const PublicIntervalDepartureSchema = z
	.object({
		boardingPoint: OptionalText(500),
		capacity: PositiveInt,
		firstDepartureTime: CanonicalTime,
		intervalMinutes: z.number().int().positive().max(1_440),
		kind: z.literal("interval"),
		lastDepartureTime: CanonicalTime,
		note: OptionalText(1_000),
		riderType: TransportRiderTypeSchema,
	})
	.strict()
	.superRefine((value, context) => {
		if (value.firstDepartureTime > value.lastDepartureTime) {
			context.addIssue({ code: "custom", message: "首班时间不能晚于末班时间" });
		}
	});

export const TransportPublicDepartureSchema = z.discriminatedUnion("kind", [
	PublicFixedDepartureSchema,
	PublicIntervalDepartureSchema,
]);

export const TransportPublicRouteSchema = z
	.object({
		boardingPoint: OptionalText(500),
		departures: z.array(TransportPublicDepartureSchema).max(2_000),
		destination: Text(500),
		note: OptionalText(1_000),
		origin: Text(500),
		routeId: Identifier,
		serviceKind: TransportServiceKindSchema,
		status: TransportScheduleStatusSchema,
	})
	.strict();

export const TransportPublicScheduleResponseSchema = z
	.object({ date: IsoDate, routes: z.array(TransportPublicRouteSchema).max(500) })
	.strict();

export type TransportServiceKind = z.infer<typeof TransportServiceKindSchema>;
export type TransportScheduleStatus = z.infer<typeof TransportScheduleStatusSchema>;
export type TransportRiderType = z.infer<typeof TransportRiderTypeSchema>;
export type TransportScheduleItem = z.infer<typeof TransportScheduleItemSchema>;
export type TransportSchedulePeriodInput = z.infer<typeof TransportSchedulePeriodInputSchema>;
export type TransportRouteInput = z.infer<typeof TransportRouteInputSchema>;
export type TransportPublicDeparture = z.infer<typeof TransportPublicDepartureSchema>;
export type TransportPublicRoute = z.infer<typeof TransportPublicRouteSchema>;
export type TransportPublicScheduleResponse = z.infer<typeof TransportPublicScheduleResponseSchema>;

export function transportPeriodIncludesDate(
	period: Pick<TransportSchedulePeriodInput, "validFrom" | "validTo" | "weekdays">,
	date: string,
): boolean {
	if (
		!isValidIsoDate(date) ||
		date < period.validFrom ||
		(period.validTo !== null && date > period.validTo)
	) {
		return false;
	}
	return period.weekdays.includes(isoWeekday(date));
}

export function transportRiderLabel(riderType: TransportRiderType): string {
	switch (riderType) {
		case "student":
			return "学生班次";
		case "teacher":
			return "教师班次";
		case "all":
			return "全体师生";
		default:
			return assertNever(riderType);
	}
}

export function transportServiceKindLabel(serviceKind: TransportServiceKind): string {
	switch (serviceKind) {
		case "commute":
			return "两校区通勤";
		case "subway":
			return "地铁接驳";
		case "special":
			return "临时班次";
		default:
			return assertNever(serviceKind);
	}
}

export function formatWeekdays(weekdays: readonly number[]): string {
	const labels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
	return weekdays.map((weekday) => labels[weekday] ?? String(weekday)).join("、");
}

function isValidIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function isoWeekday(value: string): number {
	const day = new Date(`${value}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

function assertNever(value: never): never {
	throw new Error(`Unexpected transport value: ${String(value)}`);
}
