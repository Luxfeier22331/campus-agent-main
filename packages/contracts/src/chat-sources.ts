import { z } from "zod";

export const CitationIndexesSchema = z
	.array(z.number().int().min(1).max(10))
	.min(1)
	.max(10)
	.refine((values) => new Set(values).size === values.length, "citation indexes must be unique");
const OpsCampusProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	collectionLabel: z.string(),
	kind: z.literal("campus_document"),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(false),
		href: z.string().min(1).nullable(),
		label: z.literal("查看文档"),
	}),
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
	versionSlug: z.string().regex(/^[1-9]\d*$/u),
});

const OpsWebProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	hostname: z.string().min(1),
	kind: z.literal("web_page"),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(true),
		href: z.string().min(1).nullable(),
		label: z.literal("打开网页"),
	}),
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

const OpsNoticeProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	kind: z.literal("campus_notice"),
	noticeId: z.string().min(1),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(false),
		href: z.string().min(1).nullable(),
		label: z.literal("查看通知"),
	}),
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

export const ChatSourceItemSchema = z.discriminatedUnion("kind", [
	OpsCampusProductSourceSchema,
	OpsNoticeProductSourceSchema,
	OpsWebProductSourceSchema,
]);

export type ChatSourceItem = z.infer<typeof ChatSourceItemSchema>;
