import { z } from "zod";
import {
	CitationIndexesSchema,
	type OpsRequestDetailResponse,
	type OpsRequestSummary,
} from "../../../shared/ops-contract.ts";
import type { OpsRequestDetailRow, OpsRequestRow } from "../store/types.ts";
import { isTerminalRequestStatus, normalizeAssistantKind } from "./values.ts";

const ProductCampusSourceActionSchema = z.object({
	disabledReason: z.null(),
	external: z.literal(false),
	href: z.string().min(1),
	label: z.literal("查看文档"),
});

const ProductWebSourceActionSchema = z.object({
	disabledReason: z.null(),
	external: z.literal(true),
	href: z.string().min(1),
	label: z.literal("打开网页"),
});

const ProductNoticeSourceActionSchema = z.object({
	disabledReason: z.null(),
	external: z.literal(false),
	href: z.string().min(1),
	label: z.literal("查看通知"),
});

const ProductCampusSourceItemSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	collectionLabel: z.string(),
	kind: z.literal("campus_document"),
	primaryAction: ProductCampusSourceActionSchema,
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
	versionSlug: z.string().regex(/^[1-9]\d*$/u),
});

const ProductWebSourceItemSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	hostname: z.string().min(1),
	kind: z.literal("web_page"),
	primaryAction: ProductWebSourceActionSchema,
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

const ProductNoticeSourceItemSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	kind: z.literal("campus_notice"),
	noticeId: z.string().min(1),
	primaryAction: ProductNoticeSourceActionSchema,
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

const ProductSourceItemSchema = z.discriminatedUnion("kind", [
	ProductCampusSourceItemSchema,
	ProductNoticeSourceItemSchema,
	ProductWebSourceItemSchema,
]);

const ProductSourcePartSchema = z.object({
	sourceItems: z.array(ProductSourceItemSchema),
	type: z.literal("source_items"),
});

export function toResultSummary(
	row: Pick<OpsRequestRow, "assistantKind" | "assistantMessagePresent">,
	status: OpsRequestSummary["status"],
): OpsRequestSummary["result"] {
	if (row.assistantMessagePresent) {
		return { kind: normalizeAssistantKind(row.assistantKind), state: "WRITTEN" };
	}
	return isTerminalRequestStatus(status)
		? { kind: null, state: "MISSING" }
		: { kind: null, state: "PENDING" };
}

export function toProductResult(
	row: OpsRequestDetailRow,
	status: OpsRequestSummary["status"],
	campusWebPublicOrigin?: string,
): OpsRequestDetailResponse["result"] {
	if (row.assistantMessagePresent) {
		if (row.assistantMessageText === null) {
			throw new Error("Assistant message is present without text");
		}
		return {
			kind: normalizeAssistantKind(row.assistantKind),
			sources: normalizeProductSources(row.assistantStructuredPartsJson, campusWebPublicOrigin),
			state: "WRITTEN",
			text: row.assistantMessageText,
		};
	}
	return isTerminalRequestStatus(status)
		? { reasonCode: "ASSISTANT_MESSAGE_MISSING", state: "MISSING" }
		: { state: "PENDING" };
}

type WrittenProductSource = Extract<
	OpsRequestDetailResponse["result"],
	{ state: "WRITTEN" }
>["sources"][number];

function normalizeCampusProductSourceAction(
	action: z.infer<typeof ProductCampusSourceActionSchema>,
	campusWebPublicOrigin?: string,
): Extract<WrittenProductSource, { kind: "campus_document" }>["primaryAction"] {
	const href = action.href.trim();
	if (!campusWebPublicOrigin) {
		return invalidCampusSourceAction(action, "Campus Web 地址未配置。");
	}
	try {
		const parsed = new URL(href, campusWebPublicOrigin);
		if (
			href.startsWith("//") ||
			(!href.startsWith("/") && parsed.origin !== campusWebPublicOrigin)
		) {
			return invalidCampusSourceAction(action);
		}
		if (parsed.origin !== campusWebPublicOrigin || parsed.username || parsed.password) {
			return invalidCampusSourceAction(action);
		}
		return { ...action, href: parsed.href };
	} catch {
		return invalidCampusSourceAction(action);
	}
}

function invalidCampusSourceAction(
	action: z.infer<typeof ProductCampusSourceActionSchema>,
	disabledReason = "来源链接地址无效。",
): Extract<WrittenProductSource, { kind: "campus_document" }>["primaryAction"] {
	return { ...action, disabledReason, href: null };
}

function normalizeWebProductSourceAction(
	action: z.infer<typeof ProductWebSourceActionSchema>,
): Extract<WrittenProductSource, { kind: "web_page" }>["primaryAction"] {
	try {
		const parsed = new URL(action.href.trim());
		if (
			(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			return { ...action, disabledReason: "来源链接地址无效。", href: null };
		}
		return { ...action, href: parsed.href };
	} catch {
		return { ...action, disabledReason: "来源链接地址无效。", href: null };
	}
}

function normalizeNoticeProductSource(
	source: z.infer<typeof ProductNoticeSourceItemSchema>,
): Extract<WrittenProductSource, { kind: "campus_notice" }> {
	const href = source.primaryAction.href.trim();
	if (!noticeCitationHrefMatchesNoticeId(href, source.noticeId)) {
		return {
			...source,
			primaryAction: {
				...source.primaryAction,
				disabledReason: "来源链接地址无效。",
				href: null,
			},
		};
	}
	return {
		...source,
		primaryAction: { ...source.primaryAction, href },
	};
}

function noticeCitationHrefMatchesNoticeId(value: string, noticeId: string): boolean {
	const match = /^\/notices\/([A-Za-z0-9._~-]+)$/u.exec(value);
	return match?.[1] === noticeId;
}

function normalizeProductSources(
	value: unknown,
	campusWebPublicOrigin?: string,
): Extract<OpsRequestDetailResponse["result"], { state: "WRITTEN" }>["sources"] {
	if (!Array.isArray(value)) {
		return [];
	}
	const sources: Extract<OpsRequestDetailResponse["result"], { state: "WRITTEN" }>["sources"] = [];
	for (const part of value) {
		const parsed = ProductSourcePartSchema.safeParse(part);
		if (!parsed.success) {
			continue;
		}
		for (const source of parsed.data.sourceItems) {
			if (source.kind === "campus_document") {
				sources.push({
					...source,
					primaryAction: normalizeCampusProductSourceAction(
						source.primaryAction,
						campusWebPublicOrigin,
					),
				});
				continue;
			}
			if (source.kind === "campus_notice") {
				sources.push(normalizeNoticeProductSource(source));
				continue;
			}
			sources.push({
				...source,
				primaryAction: normalizeWebProductSourceAction(source.primaryAction),
			});
		}
	}
	return sources;
}
