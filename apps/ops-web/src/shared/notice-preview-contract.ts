import { z } from "zod";

const ordinal = z.number().int().nonnegative();
export const NoticePreviewSchema = z
	.object({
		noticeId: z.number().int().positive(),
		contentHtml: z.string().nullable(),
		isExternal: z.boolean(),
		externalUrl: z.string().url().nullable(),
		images: z.array(
			z.object({
				ordinal,
				url: z.string().regex(/^\/api\/ops\/notices\/[1-9][0-9]*\/images\/(0|[1-9][0-9]*)$/u),
			}),
		),
		attachments: z.array(
			z.object({
				ordinal,
				name: z.string().nullable(),
				suffix: z.string().nullable(),
				url: z.string().regex(/^\/api\/ops\/notices\/[1-9][0-9]*\/attachments\/(0|[1-9][0-9]*)$/u),
			}),
		),
	})
	.strict();

export type NoticePreview = z.infer<typeof NoticePreviewSchema>;
