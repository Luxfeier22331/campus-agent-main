import {
	TransportRouteInputSchema,
	TransportScheduleItemSchema,
	TransportSchedulePeriodInputSchema,
} from "@campus-agent/transport/domain";
import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);
const isoDateTime = z.iso.datetime({ offset: true });

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
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
	updatedBy: identifier,
	scheduleId: identifier,
	items: z.array(TransportOpsScheduleItemSchema).max(2_000),
});

export const TransportOpsSchedulePeriodInputSchema = TransportSchedulePeriodInputSchema;

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
	createRoute(actor: TransportOpsActor, input: TransportOpsRouteCreate): Promise<TransportOpsRoute>;
	createSchedulePeriod(
		actor: TransportOpsActor,
		input: TransportOpsSchedulePeriodInput,
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
