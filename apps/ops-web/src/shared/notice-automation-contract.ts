import { z } from "zod";
import { NoticeJobRangeSchema } from "./ops-contract";

export const NoticeAutomationInputSchema = z
	.object({
		enabled: z.boolean(),
		intervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
	})
	.strict();
export type NoticeAutomationInput = z.infer<typeof NoticeAutomationInputSchema>;
export const NoticeAutomationSchema = z
	.object({
		supported: z.boolean(),
		enabled: z.boolean().nullable(),
		intervalMinutes: NoticeAutomationInputSchema.shape.intervalMinutes.nullable(),
		timeZone: z.string().nullable(),
		lastScheduleTime: z.string().nullable(),
		lastSuccessfulTime: z.string().nullable(),
		maintenanceRange: NoticeJobRangeSchema.nullable(),
		credentialAvailable: z.boolean().nullable(),
		scheduleError: z.string().nullable(),
		stateError: z.string().nullable(),
		credentialError: z.string().nullable(),
	})
	.strict();
export type NoticeAutomation = z.infer<typeof NoticeAutomationSchema>;
