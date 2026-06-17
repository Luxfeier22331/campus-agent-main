import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { AuthenticatedNoticeRunProcessingRecord } from "../types";
import {
	formatAuthenticatedNoticeStaleReasonLabel,
	formatAuthenticatedNoticeTimestamp,
} from "./authenticated-notice-formatters";
import {
	AuthenticatedNoticeFreshnessChip,
	AuthenticatedNoticeLifecycleChip,
	AuthenticatedNoticeQueueChip,
} from "./authenticated-notice-presenters";

function FieldRow(props: { label: string; value: ReactNode }) {
	return (
		<Stack spacing={0.5}>
			<Typography color="text.secondary" variant="caption">
				{props.label}
			</Typography>
			<Typography component="div" sx={{ wordBreak: "break-word" }} variant="body2">
				{props.value}
			</Typography>
		</Stack>
	);
}

function readNumber(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "number" ? value : 0;
}

function readStringList(record: Record<string, unknown>, key: string) {
	const value = record[key];
	if (!Array.isArray(value)) {
		return PANEL_COPY.notAvailable;
	}
	const text = value.map((item) => String(item)).join(", ");
	return text || PANEL_COPY.notAvailable;
}

function RunProcessingShowContent() {
	const record = useRecordContext<AuthenticatedNoticeRunProcessingRecord>();
	if (!record) {
		return null;
	}

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">
					查看该通知运行的采集、回放、队列处理和发布结果。原始正文、附件和 OCR 原文不在此页展示。
				</Alert>
				<Box
					sx={{
						display: "grid",
						gap: 2,
						gridTemplateColumns: {
							lg: "repeat(2, minmax(0, 1fr))",
							xs: "1fr",
						},
					}}
				>
					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">运行标识</Typography>
								<Divider />
								<FieldRow label="采集 run token" value={record.collectorRunToken} />
								<FieldRow label="Run Key" value={record.runKey} />
								<FieldRow label="运行 ID" value={record.runId} />
								<FieldRow label="站点" value={record.siteId} />
								<FieldRow
									label="来源"
									value={`${record.sourceChannel} / ${record.sourceSurface}`}
								/>
								<FieldRow
									label="回放批次"
									value={record.replayBatchId || PANEL_COPY.notAvailable}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">生命周期</Typography>
								<Divider />
								<FieldRow
									label="整体状态"
									value={<AuthenticatedNoticeLifecycleChip status={record.lifecycleStatus} />}
								/>
								<FieldRow
									label="最新队列状态"
									value={<AuthenticatedNoticeQueueChip status={record.latestQueueStatus} />}
								/>
								<FieldRow
									label="数据新鲜度"
									value={<AuthenticatedNoticeFreshnessChip status={record.freshnessStatus} />}
								/>
								<FieldRow
									label="滞后原因"
									value={formatAuthenticatedNoticeStaleReasonLabel(record.staleReasonCode)}
								/>
								<FieldRow
									label="观测年龄"
									value={
										record.observedAgeSeconds === null
											? PANEL_COPY.notAvailable
											: `${record.observedAgeSeconds}s / ${record.staleAfterSeconds}s`
									}
								/>
								<FieldRow label="最新阶段" value={record.latestStage} />
								<FieldRow label="队列任务数" value={record.queueJobCount} />
								<FieldRow label="尝试数" value={record.attemptCount} />
								<FieldRow
									label="首次观测"
									value={formatAuthenticatedNoticeTimestamp(record.firstObservedAt)}
								/>
								<FieldRow
									label="最近观测"
									value={formatAuthenticatedNoticeTimestamp(record.lastObservedAt)}
								/>
								<FieldRow
									label="更新时间"
									value={formatAuthenticatedNoticeTimestamp(record.projectedAt)}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">队列任务汇总</Typography>
								<Divider />
								<FieldRow label="成功" value={readNumber(record.queueStatusCounts, "succeeded")} />
								<FieldRow
									label="终止失败"
									value={readNumber(record.queueStatusCounts, "failed_terminal")}
								/>
								<FieldRow
									label="已取消"
									value={readNumber(record.queueStatusCounts, "cancelled")}
								/>
								<FieldRow
									label="错误"
									value={
										record.lastErrorCode
											? `${record.lastErrorCode}${
													record.lastErrorMessage ? ` · ${record.lastErrorMessage}` : ""
												}`
											: PANEL_COPY.none
									}
								/>
								{record.jobSummaries.map((job) => (
									<FieldRow
										key={job.jobId}
										label={job.jobId}
										value={`${job.queueStatus} · ${job.updatedAt || PANEL_COPY.notAvailable}`}
									/>
								))}
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">来源与发布</Typography>
								<Divider />
								<FieldRow
									label="选中通知数"
									value={readNumber(record.sourceTruth, "selectedNoticeCount")}
								/>
								<FieldRow
									label="发布记录"
									value={readNumber(record.downstream, "materializedReleaseCount")}
								/>
								<FieldRow
									label="候选类型"
									value={readStringList(record.downstream, "candidateKinds")}
								/>
								<FieldRow
									label="目标面"
									value={readStringList(record.downstream, "targetSurfaces")}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">处理时间线</Typography>
								<Divider />
								{record.timeline.length > 0 ? (
									<Stack spacing={1.5}>
										{record.timeline.map((event) => (
											<Stack
												key={
													event.eventId ??
													`${event.stage}:${event.status}:${event.occurredAt}:${event.summary}`
												}
												spacing={0.25}
											>
												<Typography variant="body2">
													<strong>{event.stage}</strong> · {event.status}
												</Typography>
												<Typography color="text.secondary" variant="caption">
													{formatAuthenticatedNoticeTimestamp(event.occurredAt)}
												</Typography>
												<Typography variant="body2">{event.summary}</Typography>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无时间线事件。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>
				</Box>
			</Stack>
		</PanelPage>
	);
}

export function AuthenticatedNoticeRunProcessingShowPage() {
	return (
		<Show title={PANEL_COPY.menu.authenticatedNoticeRunProcessing}>
			<RunProcessingShowContent />
		</Show>
	);
}
