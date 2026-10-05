import type { TaskStage } from "../shared/task-stages";
import {
	taskActivityStateLabels,
	taskOutcomeLabels,
	taskPhaseLabels,
	taskStageLabels,
} from "../shared/task-stages";
import { formatHumanDuration, formatTimestamp } from "./format";

const countLabels: Record<string, string> = {
	processed: "已处理",
	total: "总数",
	classified: "已分类",
	failed: "失败",
	requested: "请求",
	skipped: "跳过",
	updated: "更新",
	unchanged: "未变更",
	noticesAdded: "新增通知",
	noticesUpdated: "更新通知",
	noticesUnchanged: "未变更通知",
	noticesProcessed: "处理通知",
	noticesFailed: "失败通知",
	pagesFetched: "采集页数",
	imagesDownloaded: "下载图片",
	imagesReused: "复用图片",
	attachmentsDownloaded: "下载附件",
	attachmentsReused: "复用附件",
	notices: "发布通知",
	assets: "发布资源",
	attachmentsMissing: "缺失附件",
	objectsWritten: "写入对象",
	objectsReused: "复用对象",
};
export function TaskStageSummary({
	stages,
	observedAt = Date.now(),
}: {
	stages: TaskStage[] | undefined;
	observedAt?: number;
}) {
	if (!stages?.length) {
		return null;
	}
	return (
		<ul className="mt-3 grid gap-3 text-sm" aria-label="阶段摘要">
			{stages.map((stage) => (
				<li key={stage.id} className="min-w-0 rounded-md bg-muted/40 p-3">
					<p className="font-medium">
						{taskStageLabels[stage.id] ?? stage.id} ·{" "}
						{stage.activity && stage.outcome === "running"
							? taskActivityStateLabels[stage.activity.state]
							: taskOutcomeLabels[stage.outcome]}
					</p>
					{stage.activity ? (
						<div className="mt-1 space-y-1 text-muted-foreground">
							<p>
								{stage.activity.attempt === null
									? "尝试次数未提供"
									: `第 ${stage.activity.attempt} 次尝试`}
								{stage.activity.maximumAttempts && stage.activity.maximumAttempts > 0
									? ` / 最多 ${stage.activity.maximumAttempts} 次`
									: null}
								{stage.activity.startedAt
									? ` · 本次开始于 ${formatTimestamp(stage.activity.startedAt)}`
									: null}
							</p>
							{stage.outcome === "running" &&
							stage.activity.state === "waiting" &&
							stage.activity.scheduledAt ? (
								<p>
									等待执行已持续：
									{formatHumanDuration(observedAt - Date.parse(stage.activity.scheduledAt))}
								</p>
							) : null}
							{stage.outcome === "running" && stage.activity.nextAttemptAt ? (
								<p>下次尝试时间：{formatTimestamp(stage.activity.nextAttemptAt)}</p>
							) : null}
							<p>
								{stage.activity.lastHeartbeatAt
									? `最近状态上报：${formatTimestamp(stage.activity.lastHeartbeatAt)}（距今 ${formatHumanDuration(observedAt - Date.parse(stage.activity.lastHeartbeatAt))}）`
									: "尚未收到状态上报"}
							</p>
						</div>
					) : null}
					{stage.phase ? (
						<p className="mt-2">
							{stage.outcome === "running" ? "当前步骤" : "最后上报步骤"}：
							{taskPhaseLabels[stage.phase]}
						</p>
					) : null}
					{stage.outcome === "running" &&
					stage.activity?.state === "waiting" &&
					stage.activity.lastHeartbeatAt ? (
						<p className="mt-1 text-muted-foreground">以下为上次尝试最后上报的进度。</p>
					) : null}
					{stage.phase &&
					typeof stage.counts.processed === "number" &&
					typeof stage.counts.total === "number" &&
					stage.counts.total > 0 &&
					stage.counts.processed >= 0 &&
					stage.counts.processed <= stage.counts.total ? (
						<div className="mt-2">
							<p>
								{taskPhaseLabels[stage.phase]}：{stage.counts.processed} / {stage.counts.total}（
								{((stage.counts.processed / stage.counts.total) * 100).toFixed(1)}%）
							</p>
							<progress
								className="mt-1 h-2 w-full"
								aria-label={`${taskStageLabels[stage.id] ?? stage.id} · ${taskPhaseLabels[stage.phase]}`}
								max={stage.counts.total}
								value={stage.counts.processed}
							/>
						</div>
					) : null}
					{stage.outcome === "running" && !stage.phase && Object.keys(stage.counts).length === 0 ? (
						<p className="mt-2 text-muted-foreground">尚未收到处理进度，已处理数量未提供。</p>
					) : null}
					{stage.processedRange ? (
						<p className="mt-1">
							本次处理区间：{stage.processedRange.from} 至 {stage.processedRange.to}
						</p>
					) : null}
					{stage.maintenanceRange ? (
						<p className="mt-1">
							已维护区间：{stage.maintenanceRange.from} 至 {stage.maintenanceRange.to}
						</p>
					) : null}
					{Object.keys(stage.counts).length > 0 ? (
						<dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
							{Object.entries(stage.counts).map(([key, value]) => (
								<div className="flex gap-1" key={key}>
									<dt className="text-muted-foreground">{countLabels[key] ?? key}</dt>
									<dd className="font-medium tabular-nums">{value}</dd>
								</div>
							))}
						</dl>
					) : null}
					{stage.activity?.lastFailure && stage.activity.lastFailure !== stage.error ? (
						<p className="mt-2 whitespace-pre-wrap break-words text-danger">
							最近一次尝试失败：{stage.activity.lastFailure}
						</p>
					) : null}
					{stage.error ? (
						<p className="mt-2 whitespace-pre-wrap break-words text-danger">{stage.error}</p>
					) : null}
				</li>
			))}
		</ul>
	);
}
