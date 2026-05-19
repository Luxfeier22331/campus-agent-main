import fs from "node:fs";
import path from "node:path";

import { fetchNoticeDetail, fetchNoticePage } from "./api.js";
import type { SelectedNoticeSpec } from "./bootstrap-export-core.js";
import { normalizeNullableText, normalizeOptionalNoticeId } from "./bootstrap-export-helpers.js";
import { resolveCollectorConfig } from "./config.js";
import {
	collectHtmlVisualReferenceCandidates,
	type HtmlVisualReferencePattern,
} from "./html-visual-references.js";
import { getEnabledNoticeTypes } from "./notice-types.js";
import { createApiContextFromStorageState } from "./portal.js";
import { assertNoticeRunAdmissionAccepted, buildNoticeRunAdmission } from "./run-admission.js";
import type {
	ApiRequestContextLike,
	DisposableApiContextLike,
	NoticeCollectionMode,
	NoticeDetailResponse,
	NoticeListResponse,
	NoticeTypeConfig,
} from "./types.js";

const VISUAL_REFERENCE_PATTERNS: HtmlVisualReferencePattern[] = [
	"img_lazy_attr",
	"img_src",
	"img_srcset",
	"source_srcset",
	"style_url",
];

export interface VisualReferenceAuditNoticeInput {
	htmlValue: string;
	noticeId: number;
	noticeType: string;
	noticeTypeName: string | null;
	title: string;
}

export interface BuildVisualReferenceAuditReportInput {
	generatedAt: string;
	notices: VisualReferenceAuditNoticeInput[];
	siteId: string;
	sourceHomeUrl: string;
}

export interface VisualReferenceAuditCandidate {
	attribute_name: string;
	link_text: string | null;
	notice_id: number;
	notice_title: string;
	notice_type: string;
	notice_type_name: string | null;
	pattern: HtmlVisualReferencePattern;
	raw_url: string;
	resolved_url: string | null;
	source_tag: "img" | "source" | "style";
}

export interface VisualReferenceAuditReport {
	generated_at: string;
	site_id: string;
	source_home_url: string;
	summary: {
		notices_scanned: number;
		notices_with_visual_refs: number;
		candidates_found: number;
		pattern_counts: Record<HtmlVisualReferencePattern, number>;
	};
	candidates: VisualReferenceAuditCandidate[];
}

export interface WriteVisualReferenceAuditReportInput {
	outputDir: string;
	report: VisualReferenceAuditReport;
}

export interface WriteVisualReferenceAuditReportResult {
	reportPath: string;
}

export interface CollectVisualReferenceAuditInput {
	collectionMode?: NoticeCollectionMode;
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	fetchNoticeDetail?: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
		noticeType: string;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticePage?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		noticeType: string;
		pageSize: number;
	}) => Promise<NoticeListResponse>;
	generatedAt: string;
	maxNotices?: number;
	noticeTypes: NoticeTypeConfig[];
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	selectedNotices?: SelectedNoticeSpec[];
	siteId: string;
	sourceHomeUrl: string;
}

export function buildVisualReferenceAuditReport(
	input: BuildVisualReferenceAuditReportInput,
): VisualReferenceAuditReport {
	const candidates: VisualReferenceAuditCandidate[] = [];
	let noticesWithVisualRefs = 0;
	for (const notice of input.notices) {
		const noticeCandidates = collectHtmlVisualReferenceCandidates(notice.htmlValue);
		if (noticeCandidates.length > 0) {
			noticesWithVisualRefs += 1;
		}
		for (const candidate of noticeCandidates) {
			candidates.push({
				attribute_name: candidate.attributeName,
				link_text: candidate.linkText,
				notice_id: notice.noticeId,
				notice_title: notice.title,
				notice_type: notice.noticeType,
				notice_type_name: notice.noticeTypeName,
				pattern: candidate.pattern,
				raw_url: candidate.rawUrl,
				resolved_url: resolveUrl(candidate.rawUrl, input.sourceHomeUrl),
				source_tag: candidate.sourceTag,
			});
		}
	}
	return {
		generated_at: input.generatedAt,
		site_id: input.siteId,
		source_home_url: input.sourceHomeUrl,
		summary: {
			notices_scanned: input.notices.length,
			notices_with_visual_refs: noticesWithVisualRefs,
			candidates_found: candidates.length,
			pattern_counts: countPatterns(candidates),
		},
		candidates,
	};
}

export async function collectVisualReferenceAudit(
	input: CollectVisualReferenceAuditInput,
): Promise<VisualReferenceAuditReport> {
	const selectedNotices = normalizeSelectedNoticeSpecs(input.selectedNotices ?? []);
	const runAdmission = buildNoticeRunAdmission({
		collectionMode: input.collectionMode,
		noticeTypes: input.noticeTypes,
		selectedNotices,
	});
	assertNoticeRunAdmissionAccepted(runAdmission);
	const collectionMode = runAdmission.collection_mode;
	const createApiContext =
		input.createApiContext ??
		(() => createApiContextFromStorageState(resolveCollectorConfig(process.env)));
	const fetchPage =
		input.fetchNoticePage ??
		((pageInput) =>
			fetchNoticePage({
				...pageInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDetail =
		input.fetchNoticeDetail ??
		((detailInput) =>
			fetchNoticeDetail({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const apiContext = await createApiContext();
	const notices: VisualReferenceAuditNoticeInput[] = [];
	try {
		if (selectedNotices.length > 0) {
			for (const selectedNotice of selectedNotices) {
				const detailResponse = await fetchDetail({
					apiContext,
					noticeId: selectedNotice.noticeId,
					noticeType: selectedNotice.noticeType,
				});
				const detailInfo = detailResponse.datas?.notice_info;
				notices.push({
					htmlValue: normalizeNullableText(detailInfo?.notice_content) ?? "",
					noticeId: selectedNotice.noticeId,
					noticeType: selectedNotice.noticeType,
					noticeTypeName:
						normalizeNullableText(selectedNotice.noticeTypeName) ??
						normalizeNullableText(detailInfo?.notice_type_name) ??
						findNoticeTypeName(input.noticeTypes, selectedNotice.noticeType),
					title:
						normalizeNullableText(selectedNotice.noticeTitle) ??
						normalizeNullableText(detailInfo?.notice_title) ??
						String(selectedNotice.noticeId),
				});
			}
		} else {
			for (const noticeType of getEnabledNoticeTypes(input.noticeTypes)) {
				const pageBudget =
					collectionMode === "backfill" ? noticeType.backfillPages : noticeType.incrementalPages;
				const pageSize =
					collectionMode === "backfill"
						? noticeType.backfillPageSize
						: noticeType.incrementalPageSize;
				for (let currentPage = 1; currentPage <= pageBudget; currentPage += 1) {
					if (input.maxNotices && notices.length >= input.maxNotices) {
						break;
					}
					const pageResponse = await fetchPage({
						apiContext,
						currentPage,
						noticeType: noticeType.type,
						pageSize,
					});
					for (const item of pageResponse.datas?.tables ?? []) {
						if (input.maxNotices && notices.length >= input.maxNotices) {
							break;
						}
						const noticeId = normalizeOptionalNoticeId(item.notice_id);
						if (noticeId === null) {
							continue;
						}
						const resolvedNoticeType = String(item.notice_type ?? noticeType.type).trim();
						const detailResponse = await fetchDetail({
							apiContext,
							noticeId,
							noticeType: resolvedNoticeType,
						});
						const detailInfo = detailResponse.datas?.notice_info;
						notices.push({
							htmlValue:
								normalizeNullableText(detailInfo?.notice_content ?? item.notice_content) ?? "",
							noticeId,
							noticeType: resolvedNoticeType,
							noticeTypeName:
								normalizeNullableText(item.notice_type_name) ??
								normalizeNullableText(detailInfo?.notice_type_name) ??
								noticeType.name,
							title:
								normalizeNullableText(item.notice_title) ??
								normalizeNullableText(detailInfo?.notice_title) ??
								String(noticeId),
						});
					}
				}
			}
		}
	} finally {
		await apiContext.dispose();
	}
	return buildVisualReferenceAuditReport({
		generatedAt: input.generatedAt,
		notices,
		siteId: input.siteId,
		sourceHomeUrl: input.sourceHomeUrl,
	});
}

export function writeVisualReferenceAuditReport(
	input: WriteVisualReferenceAuditReportInput,
): WriteVisualReferenceAuditReportResult {
	fs.mkdirSync(input.outputDir, { recursive: true });
	const reportPath = path.join(input.outputDir, "visual-reference-candidates.json");
	fs.writeFileSync(reportPath, `${JSON.stringify(input.report, null, 2)}\n`, "utf-8");
	return { reportPath };
}

function countPatterns(
	candidates: VisualReferenceAuditCandidate[],
): Record<HtmlVisualReferencePattern, number> {
	const counts = Object.fromEntries(
		VISUAL_REFERENCE_PATTERNS.map((pattern) => [pattern, 0]),
	) as Record<HtmlVisualReferencePattern, number>;
	for (const candidate of candidates) {
		counts[candidate.pattern] += 1;
	}
	return counts;
}

function resolveUrl(rawUrl: string, sourceHomeUrl: string): string | null {
	try {
		return new URL(rawUrl, sourceHomeUrl).toString();
	} catch {
		return null;
	}
}

function normalizeSelectedNoticeSpecs(specs: SelectedNoticeSpec[]): SelectedNoticeSpec[] {
	const normalized: SelectedNoticeSpec[] = [];
	const seen = new Set<string>();
	for (const spec of specs) {
		const noticeId = Number(spec.noticeId);
		const noticeType = String(spec.noticeType || "").trim();
		if (!Number.isInteger(noticeId) || noticeId <= 0 || !noticeType) {
			continue;
		}
		const key = `${noticeId}:${noticeType}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		normalized.push({
			noticeId,
			noticeType,
			noticeTypeName: normalizeNullableText(spec.noticeTypeName) ?? undefined,
			noticeTitle: normalizeNullableText(spec.noticeTitle) ?? undefined,
		});
	}
	return normalized;
}

function findNoticeTypeName(noticeTypes: NoticeTypeConfig[], noticeType: string): string | null {
	return noticeTypes.find((item) => item.type === noticeType)?.name ?? null;
}
