import { z } from "zod";

export const OcrBatchSchema = z
	.object({
		id: z.uuid(),
		status: z.enum(["pending", "submitting", "submitted", "completed", "failed"]),
		createdAt: z.string(),
		pageCount: z.number().int().nonnegative(),
		missingImageCount: z.number().int().nonnegative(),
		error: z.string().nullable(),
		hasResult: z.boolean(),
		canResume: z.boolean().optional(),
	})
	.strict();
export const OcrResourceSchema = z
	.object({
		sourceKey: z.string(),
		kind: z.literal("image"),
		ordinal: z.number().int().nonnegative(),
		displayOrdinal: z.number().int().nonnegative(),
		label: z.string(),
		selectedResultId: z.string().nullable(),
		batches: z.array(OcrBatchSchema),
	})
	.strict();
export const NoticeOcrSchema = z
	.object({ noticeId: z.string(), resources: z.array(OcrResourceSchema) })
	.strict();
export const OcrImageSchema = OcrResourceSchema.extend({ noticeId: z.string() });
export type OcrImage = z.infer<typeof OcrImageSchema>;
export type OcrResource = z.infer<typeof OcrResourceSchema>;
export const OcrReadingSchema = z
	.object({
		pages: z.array(
			z.object({ index: z.number().int().nonnegative(), markdown: z.string() }).strict(),
		),
		missingImages: z.array(z.string()),
	})
	.strict();
export type NoticeOcr = z.infer<typeof NoticeOcrSchema>;
