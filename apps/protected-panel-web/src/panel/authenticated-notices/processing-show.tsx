import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { AuthenticatedNoticeProcessingRecord } from "../types";
import {
	formatAuthenticatedNoticeStaleReasonLabel,
	formatAuthenticatedNoticeTimestamp,
} from "./authenticated-notice-formatters";
import {
	AuthenticatedNoticeCandidateChip,
	AuthenticatedNoticeFreshnessChip,
	AuthenticatedNoticeLifecycleChip,
	AuthenticatedNoticeQueueChip,
	AuthenticatedNoticeToolReadyChip,
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

function countValue(record: AuthenticatedNoticeProcessingRecord, key: string) {
	const value = record.readModelCounts[key];
	return typeof value === "number" ? value : 0;
}

function latestTimelinePayloadValue(
	record: AuthenticatedNoticeProcessingRecord,
	key: string,
): string | null {
	for (const event of [...record.timeline].reverse()) {
		const value = event.payload?.[key];
		if (Array.isArray(value)) {
			const text = value.map((item) => String(item)).join(", ");
			if (text) {
				return text;
			}
		}
		if (typeof value === "number") {
			return String(value);
		}
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return null;
}

function ProcessingShowContent() {
	const record = useRecordContext<AuthenticatedNoticeProcessingRecord>();
	if (!record) {
		return null;
	}
	const admissionClass = latestTimelinePayloadValue(record, "regulationAdmissionClass");
	const promotionDisposition = latestTimelinePayloadValue(record, "promotionDisposition");
	const applicabilityStatus = latestTimelinePayloadValue(record, "applicabilityStatus");
	const targetCollection = latestTimelinePayloadValue(record, "targetCollection");
	const reasonCodes = latestTimelinePayloadValue(record, "reasonCodes");
	const auditRunId = latestTimelinePayloadValue(record, "auditRunId");
	const cleanupRunId = latestTimelinePayloadValue(record, "cleanupRunId");
	const cleanupDisposition = latestTimelinePayloadValue(record, "cleanupDisposition");
	const postgresExactRemaining = latestTimelinePayloadValue(record, "postgresExactRemaining");
	const objectStoreExactKeysRemaining = latestTimelinePayloadValue(
		record,
		"objectStoreExactKeysRemaining",
	);
	const qdrantResidueCount = latestTimelinePayloadValue(record, "qdrantResidueCount");
	const ragReleaseStatus = record.ragReleaseStatus;

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">
					详情来自 app-api
					持有的通知处理投影，只用于解释入队、消费、下游物化和工具可用状态；不显示原始正文、OCR、附件或对象存储路径。
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
								<Typography variant="h6">通知标识</Typography>
								<Divider />
								<FieldRow label="通知 ID" value={record.noticeId} />
								<FieldRow label="标题" value={record.title} />
								<FieldRow label="站点" value={record.siteId} />
								<FieldRow
									label="来源"
									value={`${record.sourceChannel} / ${record.sourceSurface}`}
								/>
								<FieldRow label="运行 ID" value={record.runId || PANEL_COPY.notAvailable} />
								<FieldRow label="队列任务" value={record.jobId || PANEL_COPY.notAvailable} />
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
									label="队列状态"
									value={<AuthenticatedNoticeQueueChip status={record.queueStatus} />}
								/>
								<FieldRow
									label="投影新鲜度"
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
								<FieldRow label="尝试次数" value={record.attemptCount} />
								<FieldRow
									label="最近观测"
									value={formatAuthenticatedNoticeTimestamp(record.lastObservedAt)}
								/>
								<FieldRow
									label="投影时间"
									value={formatAuthenticatedNoticeTimestamp(record.projectedAt)}
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
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">下游与工具</Typography>
								<Divider />
								<FieldRow
									label="候选类型"
									value={<AuthenticatedNoticeCandidateChip kind={record.candidateKind} />}
								/>
								<FieldRow label="目标面" value={record.targetSurface || PANEL_COPY.notAvailable} />
								<FieldRow
									label="工具状态"
									value={<AuthenticatedNoticeToolReadyChip ready={record.toolReady} />}
								/>
								<FieldRow label="Release" value={record.releaseId || PANEL_COPY.notAvailable} />
								<FieldRow
									label="当前指针"
									value={record.current ? PANEL_COPY.yes : PANEL_COPY.no}
								/>
								<FieldRow
									label="物化状态"
									value={record.materializationStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="文档站状态"
									value={ragReleaseStatus?.documentSiteStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="RAG 准备"
									value={ragReleaseStatus?.ragPreparationStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="RAG 索引"
									value={ragReleaseStatus?.ragIndexStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="RAG Serving"
									value={ragReleaseStatus?.ragServingStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="RAG 验证"
									value={ragReleaseStatus?.ragVerificationStatus || PANEL_COPY.notAvailable}
								/>
								<FieldRow label="Admission" value={admissionClass || PANEL_COPY.notAvailable} />
								<FieldRow
									label="Promotion"
									value={promotionDisposition || PANEL_COPY.notAvailable}
								/>
								<FieldRow label="适用状态" value={applicabilityStatus || PANEL_COPY.notAvailable} />
								<FieldRow label="目标集合" value={targetCollection || PANEL_COPY.notAvailable} />
								<FieldRow label="原因码" value={reasonCodes || PANEL_COPY.notAvailable} />
								<FieldRow label="Audit Run" value={auditRunId || PANEL_COPY.notAvailable} />
								<FieldRow label="Cleanup Run" value={cleanupRunId || PANEL_COPY.notAvailable} />
								<FieldRow label="Cleanup" value={cleanupDisposition || PANEL_COPY.notAvailable} />
								<FieldRow
									label="PG 残留"
									value={postgresExactRemaining || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="对象残留"
									value={objectStoreExactKeysRemaining || PANEL_COPY.notAvailable}
								/>
								<FieldRow
									label="Qdrant 残留"
									value={qdrantResidueCount || PANEL_COPY.notAvailable}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">班车 read-model</Typography>
								<Divider />
								<FieldRow label="排班快照" value={countValue(record, "snapshots")} />
								<FieldRow label="当前快照" value={countValue(record, "currentSnapshots")} />
								<FieldRow label="计划班次" value={countValue(record, "scheduledDepartures")} />
								<FieldRow label="拒收来源" value={countValue(record, "rejectedSources")} />
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

export function AuthenticatedNoticeProcessingShowPage() {
	return (
		<Show title={PANEL_COPY.menu.authenticatedNoticeProcessing}>
			<ProcessingShowContent />
		</Show>
	);
}
