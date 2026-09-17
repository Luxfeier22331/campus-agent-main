import type {
	DiningOpsSubmissionHistoricalPhoto,
	DiningOpsSubmissionPhoto,
	DiningOpsSubmissionRecord,
	DiningOpsSubmissionSnapshot,
} from "@campus-agent/dining/domain";
import { Badge, Button } from "@campus-agent/ui";
import { useState } from "react";
import { formatTimestamp } from "./format";

export function submissionStatusLabel(submission: DiningOpsSubmissionRecord): string {
	if (submission.status !== "purged" && submission.accountDeletingAt) {
		return "作者注销，已撤下";
	}
	if (submission.status === "public" && !submission.windowAvailable) {
		return "窗口不可用，未公开";
	}
	return {
		public: "公开",
		hidden: "已隐藏",
		deleted: "已软删除",
		expired: "已到期",
		purged: "已清理",
	}[submission.status];
}

export function SubmissionStatus({ submission }: { submission: DiningOpsSubmissionRecord }) {
	return (
		<Badge
			tone={
				submission.status === "public" &&
				submission.windowAvailable &&
				!submission.accountDeletingAt
					? "success"
					: "neutral"
			}
		>
			{submissionStatusLabel(submission)}
		</Badge>
	);
}

export function submissionRestriction(submission: DiningOpsSubmissionRecord): string | null {
	if (submission.status === "purged") {
		return "正文、照片和作者身份已清理，仅保留处理引用；不能恢复。";
	}
	if (submission.accountDeletingAt) {
		return "作者正在注销，投稿已撤下；不能通过普通操作恢复。";
	}
	if (submission.status === "expired") {
		return "30 天恢复期限已结束；正文和照片不可回放，不能恢复。";
	}
	if (submission.status === "deleted") {
		if (!submission.windowAvailable) {
			return "所属窗口不在当前公开地图中，暂时不能恢复；恢复期限不会因此延长。";
		}
		if (!submission.canRestore) {
			return "照片已开始清理，不能恢复。";
		}
		return submission.hiddenAt
			? "恢复删除后仍保持隐藏，须另行恢复公开。"
			: "恢复前会再次核对窗口、账号和清理状态。";
	}
	if (!submission.windowAvailable) {
		return "所属窗口不在当前公开地图中；投稿及关联评价不公开。";
	}
	if (submission.status === "hidden" && !submission.canUnhide) {
		return "照片已开始清理，不能恢复公开。";
	}
	return null;
}

export function SubmissionDeadline({ submission }: { submission: DiningOpsSubmissionRecord }) {
	if (submission.status === "purged") {
		return (
			<p className="text-muted-foreground text-sm">
				清理时间：{formatTimestamp(submission.purgedAt)}
			</p>
		);
	}
	if (!submission.expiresAt) {
		return null;
	}
	const remaining = Date.parse(submission.expiresAt) - Date.now();
	return (
		<p className="text-muted-foreground text-sm">
			恢复截止：{formatTimestamp(submission.expiresAt)}
			{submission.status === "deleted" && remaining > 0
				? `（剩余约 ${Math.ceil(remaining / 3600000)} 小时）`
				: ""}
		</p>
	);
}

export function SubmissionPhoto({
	photo,
	label,
}: {
	photo: DiningOpsSubmissionPhoto | DiningOpsSubmissionHistoricalPhoto;
	label: string;
}) {
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	if ("state" in photo && photo.state === "expired") {
		return <p className="text-muted-foreground text-sm">历史照片已到期或清理，不可回放。</p>;
	}
	return (
		<div className="min-w-0 space-y-2">
			{failed ? (
				<div role="alert" className="space-y-2 text-sm">
					<p>{label}读取失败。请检查访问权限或稍后重试。</p>
					<Button
						variant="outline"
						onClick={() => {
							setFailed(false);
							setAttempt((value) => value + 1);
						}}
					>
						重新读取图片
					</Button>
				</div>
			) : (
				<img
					key={attempt}
					src={photo.url}
					alt={label}
					width={photo.width}
					height={photo.height}
					onError={() => setFailed(true)}
					className="max-h-80 w-full rounded-md border border-border bg-surface object-contain"
				/>
			)}
			{"expiresAt" in photo && photo.expiresAt ? (
				<p className="text-muted-foreground text-xs">
					历史照片可回放至 {formatTimestamp(photo.expiresAt)}
				</p>
			) : null}
		</div>
	);
}

export function SubmissionSnapshot({
	snapshot,
	label,
}: {
	snapshot: DiningOpsSubmissionSnapshot;
	label: string;
}) {
	return (
		<div className="min-w-0 space-y-2">
			<h4 className="font-medium text-sm">{label}</h4>
			{snapshot.replayable ? (
				<>
					<p className="break-words font-medium">{snapshot.name}</p>
					<p className="text-sm">{snapshot.priceText ?? "未填写价格"}</p>
					{snapshot.photo ? (
						<SubmissionPhoto
							key={snapshot.photo.photoId}
							photo={snapshot.photo}
							label={`${label}照片`}
						/>
					) : (
						<p className="text-muted-foreground text-sm">该版本无照片。</p>
					)}
				</>
			) : (
				<p className="text-muted-foreground text-sm">历史内容已到期或清理，不可回放。</p>
			)}
		</div>
	);
}
