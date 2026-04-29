import { formatPanelTimestamp, PANEL_COPY } from "../panel-copy";

const OFFICIAL_WEB_RUN_INTENT_LABELS: Record<string, string> = {
	baseline: "基线",
	hot: "热点",
	repair: "修复",
};

const OFFICIAL_WEB_RUN_SUMMARY_LABELS: Record<string, string> = {
	failureCount: "失败数",
	urlsFetched: "抓取页面数",
};

const OFFICIAL_WEB_PAGE_CHANGE_SUMMARY_LABELS: Record<string, string> = {
	changedPages: "变更页面",
	deletedPages: "已删除页面",
	failedFetchPages: "抓取失败",
	newPages: "新增页面",
	notModifiedPages: "未变更页面",
};

const OFFICIAL_WEB_PAGE_CHANGE_STATUS_LABELS: Record<string, string> = {
	changed: "已变更",
	deleted: "已删除",
	fetch_failed: "抓取失败",
	new: "新增",
	not_modified: "未变更",
};

const OFFICIAL_WEB_PAGE_FAMILY_LABELS: Record<string, string> = {
	article_detail: "文章详情",
	directory_page: "目录页",
	generic_content_page: "通用内容页",
	listing_page: "列表页",
};

const OFFICIAL_WEB_CADENCE_CLASS_LABELS: Record<string, string> = {
	baseline_static: "基线静态",
	detail_recent: "近期详情",
	listing_hot: "热点列表",
	repair: "修复",
};

const OFFICIAL_WEB_CHANGE_REASON_LABELS: Record<string, string> = {
	conditional_not_modified: "条件请求未变更",
	fetch_failed: "抓取失败",
	http_deleted: "页面已删除",
	main_content_changed: "正文发生变化",
	new_page: "新增页面",
};

const OFFICIAL_WEB_FRESHNESS_SUMMARY_LABELS: Record<string, string> = {
	changedLast24h: "24 小时变更",
	deletedPages: "已删除页面",
	duePages: "当前到期",
	failedFetchPages: "抓取失败",
	hotPages: "热点页面",
	repairPages: "修复页面",
	totalPages: "总页面数",
};

export function formatOfficialWebStatusLabel(status: string) {
	switch (status) {
		case "accepted":
			return PANEL_COPY.officialWebStatus.accepted;
		case "running":
			return PANEL_COPY.officialWebStatus.running;
		case "completed":
			return PANEL_COPY.officialWebStatus.completed;
		case "completed_with_errors":
			return PANEL_COPY.officialWebStatus.completed_with_errors;
		case "failed":
			return PANEL_COPY.officialWebStatus.failed;
		case "abandoned":
			return PANEL_COPY.officialWebStatus.abandoned;
		default:
			return status;
	}
}

export function formatOfficialWebRunIntentLabel(runIntent: string) {
	return OFFICIAL_WEB_RUN_INTENT_LABELS[runIntent] ?? runIntent;
}

export function formatOfficialWebRunSummaryLabel(key: string) {
	return OFFICIAL_WEB_RUN_SUMMARY_LABELS[key] ?? key;
}

export function formatOfficialWebPageChangeSummaryLabel(key: string) {
	return OFFICIAL_WEB_PAGE_CHANGE_SUMMARY_LABELS[key] ?? key;
}

export function formatOfficialWebPageChangeStatusLabel(status: string) {
	return OFFICIAL_WEB_PAGE_CHANGE_STATUS_LABELS[status] ?? status;
}

export function formatOfficialWebPageFamilyLabel(pageFamily: string) {
	return OFFICIAL_WEB_PAGE_FAMILY_LABELS[pageFamily] ?? pageFamily;
}

export function formatOfficialWebCadenceClassLabel(cadenceClass: string) {
	return OFFICIAL_WEB_CADENCE_CLASS_LABELS[cadenceClass] ?? cadenceClass;
}

export function formatOfficialWebChangeReasonLabel(reason: string) {
	return OFFICIAL_WEB_CHANGE_REASON_LABELS[reason] ?? reason;
}

export function formatOfficialWebFreshnessSummaryLabel(key: string) {
	return OFFICIAL_WEB_FRESHNESS_SUMMARY_LABELS[key] ?? key;
}

export function formatIngestionStatusLabel(status: string | null) {
	switch (status) {
		case "completed":
			return PANEL_COPY.officialWebStatus.completed;
		case "failed":
			return PANEL_COPY.officialWebStatus.failed;
		case "running":
			return PANEL_COPY.officialWebStatus.running;
		case "pending":
			return PANEL_COPY.ingestionStatus.pending;
		case "staged":
			return PANEL_COPY.ingestionStatus.staged;
		case "promoted":
			return PANEL_COPY.ingestionStatus.promoted;
		case "succeeded":
			return PANEL_COPY.ingestionStatus.succeeded;
		case "queued":
			return PANEL_COPY.ingestionStatus.queued;
		case "dispatched":
			return PANEL_COPY.ingestionStatus.dispatched;
		case "ingestion_failed":
			return PANEL_COPY.ingestionStatus.ingestion_failed;
		case null:
			return PANEL_COPY.notAvailable;
		default:
			return status;
	}
}

export function formatTimestamp(value: string | null) {
	return formatPanelTimestamp(value);
}
