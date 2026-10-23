import { Badge } from "@campus-agent/ui";
import { NOTICE_CATEGORY_LABELS } from "campus-contracts/notices";
import type {
	NoticeJob,
	NoticeJobOperation,
	NoticeState,
	NoticeSummary,
} from "../../shared/ops-contract";

const NOTICE_STATE_LABELS: Record<NoticeState, string> = {
	needs_classification: "待分类",
	needs_publication: "待发布",
	published: "已发布",
};

const NOTICE_STATE_TONES: Record<NoticeState, "neutral" | "success" | "warning"> = {
	needs_classification: "warning",
	needs_publication: "neutral",
	published: "success",
};

const NOTICE_JOB_LABELS: Record<NoticeJob["status"], string> = {
	failed: "失败",
	pending: "等待中",
	running: "运行中",
	succeeded: "成功",
};

const NOTICE_JOB_TONES: Record<NoticeJob["status"], "danger" | "neutral" | "success" | "warning"> =
	{
		failed: "danger",
		pending: "neutral",
		running: "warning",
		succeeded: "success",
	};

const NOTICE_OPERATION_LABELS: Record<NoticeJobOperation, string> = {
	"notice-backfill": "历史回填",
	"notice-classify-missing": "分类缺失通知",
	"notice-classify-one": "单条模型分类",
	"notice-publish-one": "单条发布",
	"notice-publish-pending": "发布待发布通知",
	"notice-republish-one": "单条重新发布",
	"notice-sync": "同步新通知",
	"notice-rescan": "补查遗漏",
};

export type NoticeJobFamily = "classification" | "collection" | "publication";

export function NoticeStateBadge({ state }: { state: NoticeState }) {
	return <Badge tone={NOTICE_STATE_TONES[state]}>{NOTICE_STATE_LABELS[state]}</Badge>;
}

export function NoticeJobStatusBadge({ status }: { status: NoticeJob["status"] }) {
	return <Badge tone={NOTICE_JOB_TONES[status]}>{NOTICE_JOB_LABELS[status]}</Badge>;
}

export function NoticeCategoryBadge({ category }: { category: NoticeSummary["category"] }) {
	if (!category) {
		return <Badge tone="neutral">尚无分类结果</Badge>;
	}
	return <Badge tone="info">{NOTICE_CATEGORY_LABELS[category]}</Badge>;
}

export function noticeStateLabel(state: NoticeState): string {
	return NOTICE_STATE_LABELS[state];
}

export function noticeOperationLabel(operation: NoticeJobOperation): string {
	return NOTICE_OPERATION_LABELS[operation];
}

export function noticeJobFamily(operation: NoticeJobOperation): NoticeJobFamily {
	if (
		operation === "notice-sync" ||
		operation === "notice-backfill" ||
		operation === "notice-rescan"
	) {
		return "collection";
	}
	if (operation === "notice-classify-missing" || operation === "notice-classify-one") {
		return "classification";
	}
	return "publication";
}

export function isActiveNoticeJob(job: Pick<NoticeJob, "status">): boolean {
	return job.status === "pending" || job.status === "running";
}

export function isTerminalNoticeJob(job: Pick<NoticeJob, "status">): boolean {
	return job.status === "succeeded" || job.status === "failed";
}

export function isBatchNoticeJob(job: Pick<NoticeJob, "operation">): boolean {
	return (
		job.operation === "notice-sync" ||
		job.operation === "notice-rescan" ||
		job.operation === "notice-backfill" ||
		job.operation === "notice-classify-missing" ||
		job.operation === "notice-publish-pending"
	);
}

export function noticeJobSummaryLabel(
	operation: NoticeJobOperation,
	summary: NoticeJob["summary"],
): string | null {
	if (!summary) {
		return null;
	}
	if (summary.outcome === "skipped") {
		return "已有同类任务运行，本轮跳过";
	}
	const family = noticeJobFamily(operation);
	const entries =
		family === "collection"
			? ([
					["noticesAdded", "新增通知"],
					["noticesProcessed", "处理通知"],
					["noticesFailed", "失败通知"],
					["pagesFetched", "读取分页"],
					["objectsWritten", "写入来源对象"],
					["objectsReused", "复用来源对象"],
					["imagesDownloaded", "下载图片"],
					["imagesReused", "复用图片"],
					["attachmentsDownloaded", "下载附件"],
					["attachmentsMissing", "缺失附件"],
					["attachmentsReused", "复用附件"],
				] as const)
			: family === "classification"
				? ([
						["classified", "完成分类"],
						["failed", "处理失败"],
						["requested", "请求处理"],
						["skipped", "跳过"],
					] as const)
				: ([
						["notices", "发布通知"],
						["failed", "处理失败"],
						["assets", "发布资源"],
					] as const);
	const labels = entries.flatMap(([key, label]) =>
		summary[key] === undefined ? [] : [`${label} ${summary[key]} 条`],
	);
	if (family === "collection" && summary.upToDate !== undefined && summary.upToDate) {
		labels.push("本轮无新增通知");
	}
	return labels.length > 0 ? labels.join(" · ") : null;
}
