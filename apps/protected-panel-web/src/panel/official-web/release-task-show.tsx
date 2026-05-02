import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";

import { formatPanelTimestamp, PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OfficialWebReleaseTaskRecord } from "../types";

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

function readSummaryValue(record: Record<string, unknown>, key: string) {
	const value = record[key];
	if (value === null || value === undefined || value === "") {
		return PANEL_COPY.notAvailable;
	}
	return String(value);
}

function ReleaseTaskShowContent() {
	const record = useRecordContext<OfficialWebReleaseTaskRecord>();
	if (!record) {
		return null;
	}

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">
					详情来自 app-api 持有的发布任务安全投影；不显示对象存储定位符、原始 HTML、正文或执行栈。
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
								<Typography variant="h6">任务标识</Typography>
								<Divider />
								<FieldRow label="任务 ID" value={record.taskId} />
								<FieldRow label="任务类型" value={record.taskType} />
								<FieldRow label="清单 ID" value={record.inventoryId} />
								<FieldRow label="目标任务" value={record.jobId} />
								<FieldRow label="运行 ID" value={record.runId} />
								<FieldRow
									label="选择写目标"
									value={record.selectedWriteTarget || PANEL_COPY.notAvailable}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">生命周期</Typography>
								<Divider />
								<FieldRow label="整体状态" value={record.lifecycleStatus} />
								<FieldRow label="最新阶段" value={record.latestStage} />
								<FieldRow label="尝试次数" value={`${record.attemptCount}/${record.maxAttempts}`} />
								<FieldRow
									label="投影新鲜度"
									value={`${record.freshnessStatus}${
										record.staleReasonCode ? ` · ${record.staleReasonCode}` : ""
									}`}
								/>
								<FieldRow label="创建时间" value={formatPanelTimestamp(record.createdAt)} />
								<FieldRow label="更新时间" value={formatPanelTimestamp(record.updatedAt)} />
								<FieldRow label="投影时间" value={formatPanelTimestamp(record.projectedAt)} />
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">输入摘要</Typography>
								<Divider />
								<FieldRow
									label="来源 URL 数"
									value={readSummaryValue(record.inputSummary, "sourceUrlCount")}
								/>
								<FieldRow
									label="来源对象数"
									value={readSummaryValue(record.inputSummary, "sourceObjectCount")}
								/>
								<FieldRow
									label="策略版本"
									value={readSummaryValue(record.inputSummary, "policyVersion")}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">输出摘要</Typography>
								<Divider />
								<FieldRow
									label="Release"
									value={readSummaryValue(record.outputSummary, "releaseId")}
								/>
								<FieldRow label="Corpus" value={readSummaryValue(record.outputSummary, "corpus")} />
								<FieldRow
									label="Collection"
									value={readSummaryValue(record.outputSummary, "collection")}
								/>
								<FieldRow
									label="记录数"
									value={readSummaryValue(record.outputSummary, "recordCount")}
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

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">任务时间线</Typography>
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
													{formatPanelTimestamp(event.occurredAt)}
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

export function OfficialWebReleaseTaskShowPage() {
	return (
		<Show title={PANEL_COPY.menu.officialWebReleaseTasks}>
			<ReleaseTaskShowContent />
		</Show>
	);
}
