import {
	TransportRouteInputSchema,
	TransportScheduleItemSchema,
	TransportSchedulePeriodInputSchema,
} from "@campus-agent/transport/domain";
import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);
const isoDateTime = z.iso.datetime({ offset: true });

export const TransportNoticeLinkInputSchema = z
	.object({
		noticeId: z.number().int().positive().safe(),
		summary: z
			.string()
			.trim()
			.max(1_000)
			.nullable()
			.transform((value) => value || null),
	})
	.strict();
export const TransportNoticeLinksInputSchema = z
	.object({
		noticeLinks: z
			.array(TransportNoticeLinkInputSchema)
			.max(100)
			.refine(
				(links) => new Set(links.map((link) => link.noticeId)).size === links.length,
				"不能重复关联同一条通知。",
			),
	})
	.strict();
export const TransportNoticeLinksResponseSchema = z
	.object({
		noticeLinks: z.array(
			TransportNoticeLinkInputSchema.extend({
				title: z.string(),
				releasedAt: isoDateTime,
				isPublished: z.boolean(),
			}),
		),
	})
	.strict();
export type TransportNoticeLinkInput = z.input<typeof TransportNoticeLinkInputSchema>;
export type TransportNoticeLink = z.infer<
	typeof TransportNoticeLinksResponseSchema
>["noticeLinks"][number];

export const TransportOpsActorSchema = z
	.object({ displayName: identifier, principalId: identifier })
	.strict();

export const TransportOpsRouteSchema = TransportRouteInputSchema.extend({
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
	updatedBy: identifier,
});

export const TransportOpsRouteCreateSchema = TransportRouteInputSchema;
export const TransportOpsRouteUpdateSchema = TransportRouteInputSchema.partial()
	.strict()
	.refine((value) => Object.keys(value).length > 0, "至少需要修改一个线路字段。");

export const TransportOpsScheduleItemSchema = z.discriminatedUnion("kind", [
	TransportScheduleItemSchema.options[0].safeExtend({ itemId: identifier }),
	TransportScheduleItemSchema.options[1].safeExtend({ itemId: identifier }),
]);

export const TransportOpsSchedulePeriodSchema = TransportSchedulePeriodInputSchema.safeExtend({
	sourceReleasedAt: isoDateTime.nullable(),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
	updatedBy: identifier,
	scheduleId: identifier,
	items: z.array(TransportOpsScheduleItemSchema).max(2_000),
});

export const TransportOpsSchedulePeriodInputSchema = TransportSchedulePeriodInputSchema;
export const TransportOpsSchedulePeriodCreateSchema =
	TransportOpsSchedulePeriodInputSchema.safeExtend({
		noticeLinks: TransportNoticeLinksInputSchema.shape.noticeLinks.optional(),
	});
export type TransportOpsSchedulePeriodCreate = z.infer<
	typeof TransportOpsSchedulePeriodCreateSchema
>;

export const NoticeTransportPeriodsResponseSchema = z
	.object({
		schedulePeriods: z.array(
			z
				.object({
					scheduleId: identifier,
					routeId: identifier,
					origin: z.string(),
					destination: z.string(),
					validFrom: z.string(),
					validTo: z.string().nullable(),
					weekdays: z.array(z.number()),
					status: z.enum(["operating", "suspended"]),
					summary: z.string().nullable(),
				})
				.strict(),
		),
	})
	.strict();

export const TransportOpsRoutesResponseSchema = z
	.object({ routes: z.array(TransportOpsRouteSchema) })
	.strict();
export const TransportOpsSchedulePeriodsResponseSchema = z
	.object({ schedulePeriods: z.array(TransportOpsSchedulePeriodSchema) })
	.strict();
export const TransportOpsRouteResponseSchema = z
	.object({ route: TransportOpsRouteSchema })
	.strict();
export const TransportOpsSchedulePeriodResponseSchema = z
	.object({ schedulePeriod: TransportOpsSchedulePeriodSchema })
	.strict();

export type TransportOpsActor = z.infer<typeof TransportOpsActorSchema>;
export type TransportOpsRoute = z.infer<typeof TransportOpsRouteSchema>;
export type TransportOpsRouteCreate = z.infer<typeof TransportOpsRouteCreateSchema>;
export type TransportOpsRouteUpdate = z.infer<typeof TransportOpsRouteUpdateSchema>;
export type TransportOpsScheduleItem = z.infer<typeof TransportOpsScheduleItemSchema>;
export type TransportOpsSchedulePeriod = z.infer<typeof TransportOpsSchedulePeriodSchema>;
export type TransportOpsSchedulePeriodInput = z.infer<typeof TransportOpsSchedulePeriodInputSchema>;

export interface TransportStore {
	listSchedulePeriodNotices(scheduleId: string): Promise<TransportNoticeLink[]>;
	replaceSchedulePeriodNotices(
		scheduleId: string,
		links: TransportNoticeLinkInput[],
	): Promise<TransportNoticeLink[]>;
	listNoticeSchedulePeriods(
		noticeId: number,
	): Promise<z.infer<typeof NoticeTransportPeriodsResponseSchema>["schedulePeriods"]>;
	createRoute(actor: TransportOpsActor, input: TransportOpsRouteCreate): Promise<TransportOpsRoute>;
	createSchedulePeriod(
		actor: TransportOpsActor,
		input: TransportOpsSchedulePeriodCreate,
	): Promise<TransportOpsSchedulePeriod>;
	deleteRoute(actor: TransportOpsActor, routeId: string): Promise<void>;
	deleteSchedulePeriod(actor: TransportOpsActor, scheduleId: string): Promise<void>;
	listRoutes(): Promise<TransportOpsRoute[]>;
	listSchedulePeriods(): Promise<TransportOpsSchedulePeriod[]>;
	updateRoute(
		actor: TransportOpsActor,
		routeId: string,
		input: TransportOpsRouteUpdate,
	): Promise<TransportOpsRoute>;
	updateSchedulePeriod(
		actor: TransportOpsActor,
		scheduleId: string,
		input: TransportOpsSchedulePeriodInput,
	): Promise<TransportOpsSchedulePeriod>;
}
