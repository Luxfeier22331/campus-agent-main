import { formatPanelTimestamp } from "../panel-copy";

const LIFECYCLE_LABELS: Record<string, string> = {
	failed_retryable: "可重试失败",
	failed_terminal: "终止失败",
	imported: "已导入",
	manual_review: "人工复核",
	materialized: "已物化",
	queued: "已入队",
	succeeded: "队列成功",
	tool_ready: "工具可用",
};

const QUEUE_LABELS: Record<string, string> = {
	dead_letter: "死信",
	failed_retryable: "可重试失败",
	failed_terminal: "终止失败",
	leased: "处理中",
	manual_review: "人工复核",
	queued: "已入队",
	succeeded: "已成功",
};

const CANDIDATE_KIND_LABELS: Record<string, string> = {
	service_status: "服务状态",
	transport_schedule: "通勤班车",
};

const FRESHNESS_LABELS: Record<string, string> = {
	fresh: "新鲜",
	stale: "已滞后",
	unknown: "未知",
};

const STALE_REASON_LABELS: Record<string, string> = {
	active_processing_observation_overdue: "活跃处理超过观测窗口未更新",
	last_observed_at_missing: "缺少最近观测时间",
};

export function formatAuthenticatedNoticeLifecycleLabel(status: string | null) {
	return status ? (LIFECYCLE_LABELS[status] ?? status) : "未知";
}

export function formatAuthenticatedNoticeQueueStatusLabel(status: string | null) {
	return status ? (QUEUE_LABELS[status] ?? status) : "未知";
}

export function formatAuthenticatedNoticeCandidateKindLabel(kind: string | null) {
	return kind ? (CANDIDATE_KIND_LABELS[kind] ?? kind) : "未命中";
}

export function formatAuthenticatedNoticeFreshnessLabel(status: string | null) {
	return status ? (FRESHNESS_LABELS[status] ?? status) : "未知";
}

export function formatAuthenticatedNoticeStaleReasonLabel(reasonCode: string | null) {
	return reasonCode ? (STALE_REASON_LABELS[reasonCode] ?? reasonCode) : "无";
}

export function formatAuthenticatedNoticeTimestamp(value: string | null) {
	return formatPanelTimestamp(value);
}
