import { z } from "zod";

const OcrBatchSchema = z
	.object({
		id: z.uuid(),
		status: z.enum(["pending", "submitting", "submitted", "completed", "failed"]),
		createdAt: z.string(),
		pageCount: z.number().int().nonnegative(),
		missingImageCount: z.number().int().nonnegative(),
		error: z.string().nullable(),
		hasResult: z.boolean(),
	})
	.strict();

export const NoticeOcrSchema = z
	.object({
		noticeId: z.string(),
		resources: z.array(
			z
				.object({
					sourceKey: z.string(),
					kind: z.enum(["image", "attachment"]),
					ordinal: z.number().int().nonnegative(),
					label: z.string(),
					selectedResultId: z.string().nullable(),
					batches: z.array(OcrBatchSchema),
				})
				.strict(),
		),
	})
	.strict();

export const OcrReadingSchema = z
	.object({
		pages: z.array(
			z.object({ index: z.number().int().nonnegative(), markdown: z.string() }).strict(),
		),
		missingImages: z.array(z.string()),
	})
	.strict();

export type NoticeOcr = z.infer<typeof NoticeOcrSchema>;
