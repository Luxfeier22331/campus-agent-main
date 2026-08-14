import { convert } from "html-to-text";

export { NOTICE_DOMAINS, type NoticeDomain } from "@campus-agent/notices";

import type { NoticeDomain } from "@campus-agent/notices";

export interface NoticeClassificationInput {
	contentText: string | null;
	isExternal: boolean;
	noticeId: number;
	noticeTitle: string;
	noticeTypeName: string;
}

export type NoticeModelClassifier = (input: NoticeClassificationInput) => Promise<NoticeDomain>;

const PROCUREMENT_PATTERNS = [
	/采购/u,
	/招标(?:公告|文件)?/u,
	/比选(?:公告|文件)?/u,
	/(?:中标|中选|成交)(?:结果)?(?:公告|公示)?/u,
	/委托经营.{0,20}(?:项目|中标|中选|成交)/u,
];

const ADMISSIONS_PATTERNS = [/招生/u, /录取/u, /推免/u, /推荐免试/u, /预报名/u, /复试/u, /报考/u];

const CAMPUS_OPERATIONS_PATTERNS = [
	/暂停开放/u,
	/暂时关闭/u,
	/临时关闭/u,
	/停水/u,
	/停电/u,
	/停网/u,
	/交通管制/u,
];

const ACADEMIC_INFORMATION_PATTERNS = [
	/学术(?:讲座|报告|会议|论坛)/u,
	/(?:研究生)?刊物/u,
	/电子刊/u,
	/期刊/u,
	/新书首发/u,
	/教材.{0,12}(?:出版|上新)/u,
	/论文/u,
];

export function classifyNoticeByRule(input: NoticeClassificationInput): NoticeDomain | null {
	const title = normalizeWhitespace(input.noticeTitle);
	if (matchesAny(title, PROCUREMENT_PATTERNS)) {
		return "procurement";
	}
	if (matchesAny(title, ADMISSIONS_PATTERNS)) {
		return "admissions";
	}
	if (matchesAny(title, CAMPUS_OPERATIONS_PATTERNS)) {
		return "campus_operations";
	}
	if (matchesAny(title, ACADEMIC_INFORMATION_PATTERNS)) {
		return "academic_information";
	}
	if (normalizeWhitespace(input.noticeTypeName) === "活动报道") {
		return "campus_news";
	}
	return null;
}

export async function classifyNotice(
	input: NoticeClassificationInput,
	classifyWithModel: NoticeModelClassifier,
): Promise<NoticeDomain> {
	const ruleDomain = classifyNoticeByRule(input);
	if (ruleDomain) {
		return ruleDomain;
	}
	try {
		return await classifyWithModel(input);
	} catch (error) {
		throw new Error(`notice ${input.noticeId} model classification failed: ${formatError(error)}`, {
			cause: error,
		});
	}
}

export function cleanNoticeContentHtml(html: string | null): string | null {
	if (html === null) {
		return null;
	}
	const text = convert(html, {
		selectors: [
			{ selector: "a", options: { ignoreHref: true } },
			{ selector: "img", format: "skip" },
		],
		wordwrap: false,
	});
	const normalized = normalizeWhitespace(text);
	return normalized || null;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
