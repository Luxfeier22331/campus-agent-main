import { parseOptionalText } from "./core.ts";

const TRANSPORT_TARGET_TITLE_PATTERNS = [
	"校车.*(运行|运营|班次|时间|调整|安排)",
	"班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
	"通勤班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
	"通勤车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
	"接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
	"地铁接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
	"专车",
	"乘车点",
	"班次推迟",
];

const SERVICE_STATUS_TARGET_TITLE_PATTERNS = [
	"暑假期间.*办理",
	"寒假期间.*办理",
	"假期期间.*办理",
	"暂停.*(服务|办理|使用|访问|营业)",
	"恢复.*(服务|办理|使用|开放|营业|浴室|正常)",
	"(临时|暂时).*(关闭|停用|办理)",
	"开放时间",
	"服务时间",
	"营业时间",
	"工作安排",
	"门诊",
	"开诊",
	"闭馆",
	"食堂.*开放",
	"校医院",
	"浴室.*(试运行|恢复|开放)",
	"停车权限",
	"停水",
	"停电",
	"断网",
	"升级维护",
];

export interface AuthenticatedNoticeAttachmentCounts {
	attachmentDocumentCount: number;
	attachmentRefCount: number;
	multimodalProcessingRequiredCount: number;
	ocrRequiredCount: number;
	referenceOnlyCount: number;
	textExtractableCount: number;
}

export function resolveAuthenticatedNoticeAttachmentCounts(input: {
	attachmentRefs?: readonly Record<string, unknown>[];
	bundleRecord: Record<string, unknown>;
}): AuthenticatedNoticeAttachmentCounts {
	const attachmentRefs =
		input.attachmentRefs ??
		arrayOrEmpty(input.bundleRecord.notice_attachments ?? input.bundleRecord.attachments).filter(
			isRecord,
		);
	const textExtractableCount = attachmentRefs.filter(isTextExtractableAttachmentRef).length;
	const ocrRequiredCount = attachmentRefs.filter(isOcrRequiredAttachmentRef).length;
	const multimodalProcessingRequiredCount = attachmentRefs.filter(
		isCandidateFactCarrierAttachmentRef,
	).length;
	return {
		attachmentDocumentCount: textExtractableCount + ocrRequiredCount,
		attachmentRefCount: attachmentRefs.length,
		multimodalProcessingRequiredCount,
		ocrRequiredCount,
		referenceOnlyCount: attachmentRefs.length - multimodalProcessingRequiredCount,
		textExtractableCount,
	};
}

export function resolveAuthenticatedNoticeTargetCandidates(input: {
	noticeFamily: string;
	primaryRoute: string;
	title: string;
}): string[] {
	if (input.primaryRoute === "regulation_candidate") {
		return ["regulation"];
	}
	if (input.primaryRoute !== "service_status_candidate") {
		return [];
	}
	if (isTransportScheduleTarget(input.noticeFamily, input.title)) {
		return ["transport_schedule"];
	}
	if (isServiceStatusTarget(input.noticeFamily, input.title)) {
		return ["service_status"];
	}
	return [];
}

export function findMissingTransportScheduleAttachmentRefIds(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	contentBlocks: readonly Record<string, unknown>[];
	routingSample: {
		noticeFamily: string;
		noticeTitle: string;
		suggestedConsumptionRoute: string;
	};
}): string[] {
	const targetCandidates = resolveAuthenticatedNoticeTargetCandidates({
		noticeFamily: input.routingSample.noticeFamily,
		primaryRoute: input.routingSample.suggestedConsumptionRoute,
		title: input.routingSample.noticeTitle,
	});
	if (!targetCandidates.includes("transport_schedule")) {
		return [];
	}
	const bodyText = contentBlocksText(input.contentBlocks);
	if (hasExtractableScheduleBody(input.routingSample.noticeTitle, bodyText)) {
		return [];
	}
	if (!hasTransportScheduleAttachmentFactSignal(input.routingSample.noticeTitle, bodyText)) {
		return [];
	}
	return input.attachmentRefs
		.filter(isCandidateFactCarrierAttachmentRef)
		.map((ref) => parseOptionalText(ref.attachment_ref_id))
		.filter((value): value is string => Boolean(value));
}

export function hasAuthenticatedNoticeAttachmentValueSignal(input: {
	body: string;
	machineProcessingValueTerms: readonly string[];
	title: string;
}): boolean {
	if (input.machineProcessingValueTerms.length === 0) {
		return false;
	}
	const text = compactRoutingText(`${input.title}\n${input.body}`);
	return input.machineProcessingValueTerms.some((term) => {
		const compactedTerm = compactRoutingText(term);
		return Boolean(compactedTerm) && text.includes(compactedTerm);
	});
}

function hasExtractableScheduleBody(title: string, bodyText: string): boolean {
	const text = normalizeWhitespace(`${title}\n${bodyText}`);
	return /(?:出发|接站|返程|去程)\s*[:：].*?第[一二三四五六七八九十]+班\s*(?:[01]?\d|2[0-3])[:：][0-5]\d/su.test(
		text,
	);
}

function hasTransportScheduleAttachmentFactSignal(title: string, bodyText: string): boolean {
	const text = `${title}\n${bodyText}`;
	return (
		["班车", "通勤车", "校车", "接驳车", "专车"].some((term) => text.includes(term)) &&
		["安排", "班次", "运行", "运营", "发车", "时刻表"].some((term) => text.includes(term)) &&
		["如下", "下表", "图片", "安排", "具体"].some((term) => text.includes(term))
	);
}

function isTransportScheduleTarget(noticeFamily: string, title: string): boolean {
	return (
		["transport_commute_status", "facility_transport_classroom_status"].includes(noticeFamily) &&
		TRANSPORT_TARGET_TITLE_PATTERNS.some((pattern) => regexMatches(pattern, title))
	);
}

function isServiceStatusTarget(noticeFamily: string, title: string): boolean {
	return (
		[
			"service_status_override",
			"facility_service_status",
			"facility_transport_classroom_status",
			"it_platform_service_status",
			"library_service_status",
		].includes(noticeFamily) &&
		SERVICE_STATUS_TARGET_TITLE_PATTERNS.some((pattern) => regexMatches(pattern, title))
	);
}

function isCandidateFactCarrierAttachmentRef(ref: Record<string, unknown>): boolean {
	if (looksReservationOrQrOnly(ref)) {
		return false;
	}
	const role = String(ref.resource_role ?? "").toLowerCase();
	const contentKind = String(ref.content_kind ?? "").toLowerCase();
	const mimeType = String(ref.mime_type ?? "").toLowerCase();
	const filename = String(ref.original_filename ?? ref.source_url ?? "").toLowerCase();
	return (
		role === "inline_image" ||
		contentKind === "inline_image" ||
		mimeType.startsWith("image/") ||
		mimeType === "application/pdf" ||
		[
			"msword",
			"officedocument",
			"ms-excel",
			"ms-powerpoint",
			"spreadsheet",
			"presentation",
			"wordprocessing",
		].some((token) => mimeType.includes(token)) ||
		[
			".png",
			".jpg",
			".jpeg",
			".webp",
			".gif",
			".bmp",
			".pdf",
			".doc",
			".docx",
			".xls",
			".xlsx",
			".ppt",
			".pptx",
		].some((extension) => filename.endsWith(extension))
	);
}

function isTextExtractableAttachmentRef(ref: Record<string, unknown>): boolean {
	if (looksReservationOrQrOnly(ref)) {
		return false;
	}
	const mimeType = String(ref.mime_type ?? "").toLowerCase();
	const filename = String(ref.original_filename ?? ref.source_url ?? "").toLowerCase();
	return (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType === "application/xml" ||
		["msword", "officedocument", "ms-excel", "spreadsheet", "wordprocessing"].some((token) =>
			mimeType.includes(token),
		) ||
		[".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".md"].some((extension) =>
			filename.endsWith(extension),
		)
	);
}

function isOcrRequiredAttachmentRef(ref: Record<string, unknown>): boolean {
	if (looksReservationOrQrOnly(ref)) {
		return false;
	}
	const mimeType = String(ref.mime_type ?? "").toLowerCase();
	const filename = String(ref.original_filename ?? ref.source_url ?? "").toLowerCase();
	return (
		mimeType.startsWith("image/") ||
		mimeType === "application/pdf" ||
		[".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".pdf"].some((extension) =>
			filename.endsWith(extension),
		)
	);
}

function looksReservationOrQrOnly(ref: Record<string, unknown>): boolean {
	const text = [
		"anchor_text",
		"original_filename",
		"source_url",
		"normalized_source_url",
		"final_url",
	]
		.map((field) => String(ref[field] ?? ""))
		.join(" ");
	return ["二维码", "扫码", "扫一扫", "预约"].some((term) => text.includes(term));
}

function contentBlocksText(contentBlocks: readonly Record<string, unknown>[]): string {
	return contentBlocks
		.filter((block) => String(block.block_role ?? "") !== "title")
		.map((block) => parseOptionalText(block.text_normalized) ?? parseOptionalText(block.text_raw))
		.filter((value): value is string => Boolean(value))
		.join("\n");
}

function regexMatches(pattern: string, text: string): boolean {
	return new RegExp(pattern, "iu").test(text);
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function compactRoutingText(value: string): string {
	return String(value ?? "").replace(/\s+/gu, "");
}

function arrayOrEmpty(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
