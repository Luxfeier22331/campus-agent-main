import type {
	NoticeCollectionMode,
	NoticeRunAdmissionPageBudget,
	NoticeRunAdmissionReport,
	NoticeTypeConfig,
} from "./types";

export interface NoticeRunAdmissionInput {
	collectionMode?: NoticeCollectionMode;
	noticeTypes: NoticeTypeConfig[];
	selectedNotices?: Array<{
		noticeId: number | string;
		noticeType: string;
	}>;
}

export function buildNoticeRunAdmission(
	input: NoticeRunAdmissionInput,
): NoticeRunAdmissionReport {
	const selectedNotices = normalizeSelectedNotices(input.selectedNotices ?? []);
	const collectionMode: NoticeCollectionMode =
		selectedNotices.length > 0 ? "selected" : (input.collectionMode ?? "incremental");
	const rejectionReasons: string[] = [];
	let noticeTypeIds: string[] = [];
	let selectedNoticeIds: string[] = [];
	let pageBudget: NoticeRunAdmissionPageBudget[] = [];

	if (collectionMode === "selected") {
		selectedNoticeIds = uniqueStrings(selectedNotices.map((item) => String(item.noticeId)));
		noticeTypeIds = uniqueStrings(selectedNotices.map((item) => item.noticeType));
		if (selectedNoticeIds.length === 0) {
			rejectionReasons.push("selected_notice_ids_required");
		}
	} else {
		const enabledNoticeTypes = input.noticeTypes.filter((item) => item.enabled);
		if (enabledNoticeTypes.length === 0) {
			rejectionReasons.push("enabled_notice_types_required");
		}
		noticeTypeIds = enabledNoticeTypes.map((item) => item.type);
		pageBudget = enabledNoticeTypes.map((item) => {
			const budget =
				collectionMode === "backfill"
					? { pages: item.backfillPages, pageSize: item.backfillPageSize }
					: { pages: item.incrementalPages, pageSize: item.incrementalPageSize };
			return {
				notice_type: item.type,
				notice_type_name: item.name,
				pages: budget.pages,
				page_size: budget.pageSize,
			};
		});
	}

	return {
		accepted: rejectionReasons.length === 0,
		collection_mode: collectionMode,
		notice_type_ids: noticeTypeIds,
		selected_notice_ids: selectedNoticeIds,
		expected_page_count: pageBudget.reduce((total, item) => total + item.pages, 0),
		page_budget: pageBudget,
		rejection_reasons: rejectionReasons,
	};
}

export function assertNoticeRunAdmissionAccepted(report: NoticeRunAdmissionReport): void {
	if (report.accepted) {
		return;
	}
	throw new Error(`collector run admission rejected: ${report.rejection_reasons.join(", ")}`);
}

function normalizeSelectedNotices(
	selectedNotices: NoticeRunAdmissionInput["selectedNotices"],
): Array<{ noticeId: string; noticeType: string }> {
	const normalized: Array<{ noticeId: string; noticeType: string }> = [];
	for (const item of selectedNotices ?? []) {
		const noticeId = String(item.noticeId || "").trim();
		const noticeType = String(item.noticeType || "").trim();
		if (!noticeId || !noticeType) {
			continue;
		}
		normalized.push({ noticeId, noticeType });
	}
	return normalized;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
