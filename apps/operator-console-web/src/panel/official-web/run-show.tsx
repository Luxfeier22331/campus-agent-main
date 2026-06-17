import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OfficialWebRunRecord } from "../types";
import {
	formatOfficialWebChangeReasonLabel,
	formatOfficialWebPageChangeSummaryLabel,
	formatOfficialWebPageFamilyLabel,
	formatOfficialWebRunSummaryLabel,
	formatTimestamp,
} from "./official-web-formatters";
import {
	OfficialWebArtifactList,
	OfficialWebIngestionStatusChip,
	OfficialWebPageChangeChip,
	OfficialWebRunIntentChip,
	OfficialWebRunStatusChip,
} from "./official-web-presenters";

function RunFieldRow(props: { label: string; value: ReactNode }) {
	return (
		<Stack spacing={0.5}>
			<Typography color="text.secondary" variant="caption">
				{props.label}
			</Typography>
			<Typography component="div" variant="body2">
				{props.value}
			</Typography>
		</Stack>
	);
}

function OfficialWebRunShowContent() {
	const record = useRecordContext<OfficialWebRunRecord>();

	if (!record) {
		return null;
	}

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">查看采集运行结果、产物引用和分发状态。</Alert>

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
								<RunFieldRow label="运行 ID" value={record.runId} />
								<RunFieldRow label="站点 ID" value={record.siteId} />
								<RunFieldRow
									label="运行意图"
									value={<OfficialWebRunIntentChip runIntent={record.runIntent} />}
								/>
								<RunFieldRow
									label="状态"
									value={<OfficialWebRunStatusChip status={record.status} />}
								/>
								<RunFieldRow
									label="分发"
									value={<OfficialWebIngestionStatusChip status={record.ingestionDispatchStatus} />}
								/>
								<RunFieldRow
									label="执行"
									value={
										<OfficialWebIngestionStatusChip status={record.ingestionExecutionStatus} />
									}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">生命周期</Typography>
								<Divider />
								<RunFieldRow label="开始时间" value={formatTimestamp(record.startedAt)} />
								<RunFieldRow label="最近心跳" value={formatTimestamp(record.lastHeartbeatAt)} />
								<RunFieldRow label="结束时间" value={formatTimestamp(record.finishedAt)} />
								<RunFieldRow label="更新时间" value={formatTimestamp(record.projectedAt)} />
								<RunFieldRow
									label="执行更新时间"
									value={formatTimestamp(record.ingestionExecutionUpdatedAt)}
								/>
								<RunFieldRow label="失败数" value={record.failureCount} />
								<RunFieldRow
									label="执行引用"
									value={record.ingestionExecutionRef || PANEL_COPY.notAvailable}
								/>
								<RunFieldRow
									label="执行错误"
									value={
										record.ingestionExecutionErrorCode
											? `${record.ingestionExecutionErrorCode}${
													record.ingestionExecutionErrorMessage
														? ` · ${record.ingestionExecutionErrorMessage}`
														: ""
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
								<Typography variant="h6">运行摘要</Typography>
								<Divider />
								{record.summary ? (
									<Stack spacing={0.75}>
										{Object.entries(record.summary).map(([key, value]) => (
											<RunFieldRow
												key={key}
												label={formatOfficialWebRunSummaryLabel(key)}
												value={String(value)}
											/>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无运行摘要。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">页面变化摘要</Typography>
								<Divider />
								{record.pageChangeSummary ? (
									<Stack spacing={0.75}>
										{Object.entries(record.pageChangeSummary).map(([key, value]) => (
											<RunFieldRow
												key={key}
												label={formatOfficialWebPageChangeSummaryLabel(key)}
												value={String(value)}
											/>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无页面变化摘要。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">页面变化明细</Typography>
								<Divider />
								{record.pageChanges && record.pageChanges.length > 0 ? (
									<Stack spacing={1.5}>
										{record.pageChanges.map((change) => (
											<Stack key={change.id} spacing={0.5}>
												<Stack
													direction="row"
													spacing={1}
													sx={{ alignItems: "center", flexWrap: "wrap" }}
												>
													<OfficialWebPageChangeChip change={change} />
													<Typography variant="body2">
														{change.pageTitleNormalized || change.normalizedCanonicalUrl}
													</Typography>
													<Typography color="text.secondary" variant="caption">
														{formatOfficialWebPageFamilyLabel(change.pageFamily)}
													</Typography>
												</Stack>
												<Typography sx={{ wordBreak: "break-all" }} variant="body2">
													{change.normalizedCanonicalUrl}
												</Typography>
												<Typography color="text.secondary" variant="caption">
													{formatOfficialWebChangeReasonLabel(change.lastChangeReason)} · 观测于{" "}
													{formatTimestamp(change.observedAt)}
												</Typography>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										当前运行暂无页面变化记录。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">产物</Typography>
								<Divider />
								<OfficialWebArtifactList artifacts={record.artifacts} />
							</Stack>
						</CardContent>
					</Card>
				</Box>
			</Stack>
		</PanelPage>
	);
}

export function OfficialWebRunShowPage() {
	return (
		<Show title="官网采集运行详情">
			<OfficialWebRunShowContent />
		</Show>
	);
}
