import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import type { OfficialWebFreshnessPageRecord, OfficialWebSiteRecord } from "../types";
import {
	formatOfficialWebCadenceClassLabel,
	formatOfficialWebChangeReasonLabel,
	formatOfficialWebPageFamilyLabel,
	formatTimestamp,
} from "./official-web-formatters";
import {
	OfficialWebFreshnessSummaryGrid,
	OfficialWebHostsSummary,
	OfficialWebIngestionStatusChip,
	OfficialWebPageChangeChip,
	OfficialWebRunIntentChip,
	OfficialWebRunStatusChip,
} from "./official-web-presenters";

function SiteFieldRow(props: { label: string; value: ReactNode }) {
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

function formatFreshnessTiming(page: OfficialWebFreshnessPageRecord) {
	if (page.lastFetchDisposition === "deleted") {
		return `最近见于 ${formatTimestamp(page.lastSeenAt)}`;
	}
	if (page.lastFetchDisposition === "fetch_failed") {
		return `下次重试 ${formatTimestamp(page.nextEligibleFetchAt)}`;
	}

	return `下次可抓取 ${formatTimestamp(page.nextEligibleFetchAt)}`;
}

function FreshnessBacklogSection(props: {
	emptyLabel: string;
	pages: OfficialWebFreshnessPageRecord[] | undefined;
	title: string;
}) {
	const pages = props.pages ?? [];

	return (
		<Card>
			<CardContent>
				<Stack spacing={2}>
					<Typography variant="h6">{props.title}</Typography>
					<Divider />
					{pages.length > 0 ? (
						<Stack spacing={1.5}>
							{pages.map((page) => (
								<Stack key={`${page.siteId}:${page.normalizedCanonicalUrl}`} spacing={0.5}>
									<Typography variant="body2">
										{page.pageTitleNormalized || page.normalizedCanonicalUrl}
									</Typography>
									<Typography sx={{ wordBreak: "break-all" }} variant="body2">
										{page.normalizedCanonicalUrl}
									</Typography>
									<Typography color="text.secondary" variant="caption">
										{page.host} • {formatOfficialWebPageFamilyLabel(page.pageFamily)} •{" "}
										{formatOfficialWebCadenceClassLabel(page.cadenceClass)} • 优先级{" "}
										{page.priorityScore}
									</Typography>
									<Typography color="text.secondary" variant="caption">
										{formatOfficialWebChangeReasonLabel(page.lastChangeReason)} •{" "}
										{formatFreshnessTiming(page)}
									</Typography>
								</Stack>
							))}
						</Stack>
					) : (
						<Typography color="text.secondary" variant="body2">
							{props.emptyLabel}
						</Typography>
					)}
				</Stack>
			</CardContent>
		</Card>
	);
}

function OfficialWebSiteShowContent() {
	const record = useRecordContext<OfficialWebSiteRecord>();

	if (!record) {
		return null;
	}

	return (
		<Box sx={{ p: 3 }}>
			<Stack spacing={3}>
				<Alert severity="info">
					此视图展示 app-api 维护的 official_web
					站点投影、最近采集运行，以及后续会交给控制面的页面新鲜度积压队列。它不是基础设施控制台。
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
								<Typography variant="h6">站点标识</Typography>
								<Divider />
								<SiteFieldRow label="站点 ID" value={record.siteId} />
								<SiteFieldRow label="显示名称" value={record.displayName} />
								<SiteFieldRow
									label="主机"
									value={<OfficialWebHostsSummary hostRoots={record.hostRoots} />}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">最近投影</Typography>
								<Divider />
								<SiteFieldRow label="最近运行" value={record.latestRunId || PANEL_COPY.noRuns} />
								<SiteFieldRow
									label="最近状态"
									value={
										record.latestRunStatus ? (
											<OfficialWebRunStatusChip status={record.latestRunStatus} />
										) : (
											PANEL_COPY.noRuns
										)
									}
								/>
								<SiteFieldRow
									label="分发"
									value={
										<OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />
									}
								/>
								<SiteFieldRow label="最近成功" value={formatTimestamp(record.lastSuccessAt)} />
								<SiteFieldRow label="最近失败" value={formatTimestamp(record.lastFailureAt)} />
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">新鲜度</Typography>
								<Divider />
								{record.freshnessSummary ? (
									<OfficialWebFreshnessSummaryGrid summary={record.freshnessSummary} />
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无新鲜度摘要。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Box
						sx={{
							display: "grid",
							gap: 2,
							gridColumn: { lg: "1 / -1", xs: "auto" },
							gridTemplateColumns: {
								lg: "repeat(2, minmax(0, 1fr))",
								xs: "1fr",
							},
						}}
					>
						<FreshnessBacklogSection
							emptyLabel="暂无当前到期页面。"
							pages={record.freshnessBacklog?.duePages}
							title="当前到期"
						/>
						<FreshnessBacklogSection
							emptyLabel="暂无热点队列页面。"
							pages={record.freshnessBacklog?.hotPages}
							title="热点队列"
						/>
						<FreshnessBacklogSection
							emptyLabel="暂无抓取失败积压。"
							pages={record.freshnessBacklog?.failedFetchPages}
							title="抓取失败"
						/>
						<FreshnessBacklogSection
							emptyLabel="暂无已删除页面。"
							pages={record.freshnessBacklog?.deletedPages}
							title="已删除"
						/>
					</Box>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">最近运行</Typography>
								<Divider />
								{record.recentRuns && record.recentRuns.length > 0 ? (
									<Stack spacing={1.5}>
										{record.recentRuns.map((run) => (
											<Stack key={run.runId} spacing={0.5}>
												<Typography variant="body2">
													<strong>{run.runId}</strong>
												</Typography>
												<Stack
													direction="row"
													spacing={1}
													sx={{ alignItems: "center", flexWrap: "wrap" }}
												>
													<OfficialWebRunIntentChip runIntent={run.runIntent} />
													<OfficialWebRunStatusChip status={run.status} />
													<OfficialWebIngestionStatusChip status={run.ingestionDispatchStatus} />
													<Typography color="text.secondary" variant="caption">
														开始于 {formatTimestamp(run.startedAt)}
													</Typography>
												</Stack>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										{PANEL_COPY.noRecentRuns}
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">最近页面变化</Typography>
								<Divider />
								{record.recentPageChanges && record.recentPageChanges.length > 0 ? (
									<Stack spacing={1.5}>
										{record.recentPageChanges.map((change) => (
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
										暂无最近页面变化。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>
				</Box>
			</Stack>
		</Box>
	);
}

export function OfficialWebSiteShowPage() {
	return (
		<Show title="官网站点详情">
			<OfficialWebSiteShowContent />
		</Show>
	);
}
