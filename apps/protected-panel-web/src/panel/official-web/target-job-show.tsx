import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Show, useRecordContext } from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OfficialWebTargetJobRecord } from "../types";
import { formatTimestamp } from "./official-web-formatters";
import {
	OfficialWebArtifactVerificationChip,
	OfficialWebConsumerFamilyChip,
	OfficialWebMaterializationPolicyChip,
	OfficialWebTargetJobStatusChip,
} from "./official-web-presenters";
import { buildOfficialWebRunShowPath } from "./official-web-routes";

function TargetJobFieldRow(props: { label: string; value: ReactNode }) {
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

function InlineList(props: { emptyLabel?: string; values: string[] }) {
	if (props.values.length === 0) {
		return <>{props.emptyLabel ?? PANEL_COPY.none}</>;
	}

	return (
		<Stack spacing={0.5}>
			{props.values.map((value) => (
				<Typography key={value} sx={{ wordBreak: "break-all" }} variant="body2">
					{value}
				</Typography>
			))}
		</Stack>
	);
}

function OfficialWebTargetJobShowContent() {
	const record = useRecordContext<OfficialWebTargetJobRecord>();

	if (!record) {
		return null;
	}

	const candidates = record.candidates ?? [];
	const attempts = record.attempts ?? [];
	const verificationSummaries = record.artifactVerificationSummaries ?? [];

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">
					目标任务详情来自 app-api operator 投影。页面展示 URL
					候选、抓取尝试和校验状态，不把对象存储 key 或采集器本地路径作为面板契约。
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
								<Typography variant="h6">目标任务</Typography>
								<Divider />
								<TargetJobFieldRow label="目标任务 ID" value={record.id} />
								<TargetJobFieldRow label="站点 ID" value={record.siteId} />
								<TargetJobFieldRow label="目标 ID" value={record.targetId} />
								<TargetJobFieldRow
									label="状态"
									value={<OfficialWebTargetJobStatusChip status={record.status} />}
								/>
								<TargetJobFieldRow
									label="消费族"
									value={<OfficialWebConsumerFamilyChip consumerFamily={record.consumerFamily} />}
								/>
								<TargetJobFieldRow
									label="物化策略"
									value={
										<OfficialWebMaterializationPolicyChip
											materializationPolicy={record.materializationPolicy}
										/>
									}
								/>
								<TargetJobFieldRow
									label="产物校验"
									value={<OfficialWebArtifactVerificationChip record={record} />}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">准入与写入</Typography>
								<Divider />
								<TargetJobFieldRow label="声明版本" value={record.declarationVersion} />
								<TargetJobFieldRow label="所有者面" value={record.ownerSurface} />
								<TargetJobFieldRow
									label="写入目标"
									value={record.selectedWriteTarget || PANEL_COPY.notSelected}
								/>
								<TargetJobFieldRow label="保留策略" value={record.retentionPolicy} />
								<TargetJobFieldRow label="评审策略" value={record.reviewPolicy} />
								<TargetJobFieldRow label="仅清单" value={record.inventoryOnly ? "是" : "否"} />
								<TargetJobFieldRow label="候选数" value={record.candidateCount} />
								<TargetJobFieldRow label="尝试数" value={record.attemptCount} />
								<TargetJobFieldRow
									label="最近运行"
									value={
										record.latestRunId ? (
											<Button
												component={RouterLink}
												size="small"
												to={buildOfficialWebRunShowPath(record.latestRunId)}
											>
												{record.latestRunId}
											</Button>
										) : (
											PANEL_COPY.notAttached
										)
									}
								/>
								<TargetJobFieldRow label="更新时间" value={formatTimestamp(record.updatedAt)} />
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">目标证据声明</Typography>
								<Divider />
								<Box
									sx={{
										display: "grid",
										gap: 2,
										gridTemplateColumns: {
											md: "repeat(3, minmax(0, 1fr))",
											xs: "1fr",
										},
									}}
								>
									<TargetJobFieldRow
										label="来源主机"
										value={<InlineList values={record.sourceHosts} />}
									/>
									<TargetJobFieldRow
										label="URL 线索"
										value={<InlineList values={record.urlHints} />}
									/>
									<TargetJobFieldRow
										label="标题线索"
										value={<InlineList values={record.titleHints} />}
									/>
									<TargetJobFieldRow
										label="必要证据"
										value={<InlineList values={record.requiredEvidence} />}
									/>
								</Box>
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">候选 URL</Typography>
								<Divider />
								{candidates.length > 0 ? (
									<Stack spacing={1.5}>
										{candidates.map((candidate) => (
											<Stack key={candidate.candidateId} spacing={0.5}>
												<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
													<Typography variant="body2">{candidate.candidateId}</Typography>
													<Typography color="text.secondary" variant="caption">
														{candidate.status} · priority {candidate.priorityScore}
													</Typography>
												</Stack>
												<Typography sx={{ wordBreak: "break-all" }} variant="body2">
													{candidate.normalizedCandidateUrl}
												</Typography>
												<Typography color="text.secondary" variant="caption">
													{candidate.sourceHost} · {candidate.eligibilityReason}
												</Typography>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无候选 URL。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">抓取尝试</Typography>
								<Divider />
								{attempts.length > 0 ? (
									<Stack spacing={1.5}>
										{attempts.map((attempt) => (
											<Stack key={attempt.attemptId} spacing={0.5}>
												<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
													<Typography variant="body2">{attempt.attemptId}</Typography>
													<Typography color="text.secondary" variant="caption">
														{attempt.attemptStatus} · HTTP{" "}
														{attempt.httpStatus ?? PANEL_COPY.unknown}
													</Typography>
													<Typography color="text.secondary" variant="caption">
														产物已登记：{attempt.artifactCaptured ? "是" : "否"}
													</Typography>
												</Stack>
												<Typography sx={{ wordBreak: "break-all" }} variant="body2">
													{attempt.normalizedCanonicalUrl}
												</Typography>
												<Typography color="text.secondary" variant="caption">
													运行 {attempt.runId ?? PANEL_COPY.notAttached} ·{" "}
													{formatTimestamp(attempt.attemptedAt)}
												</Typography>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无抓取尝试。
									</Typography>
								)}
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">校验与释放状态</Typography>
								<Divider />
								{verificationSummaries.length > 0 ? (
									<Stack spacing={1.5}>
										{verificationSummaries.map((summary) => (
											<Stack key={summary.summaryId} spacing={0.5}>
												<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
													<Typography variant="body2">{summary.summaryId}</Typography>
													<Typography color="text.secondary" variant="caption">
														{summary.status} · canonical{" "}
														{summary.canonicalVerification ? "是" : "否"}
													</Typography>
												</Stack>
												<Typography color="text.secondary" variant="caption">
													运行 {summary.runId ?? PANEL_COPY.notAttached} ·{" "}
													{formatTimestamp(summary.updatedAt)}
												</Typography>
												<Typography
													component="pre"
													sx={{
														bgcolor: "action.hover",
														borderRadius: 1,
														fontFamily: "monospace",
														fontSize: "0.75rem",
														m: 0,
														overflowX: "auto",
														p: 1,
													}}
												>
													{JSON.stringify(summary.summary, null, 2)}
												</Typography>
											</Stack>
										))}
									</Stack>
								) : (
									<Typography color="text.secondary" variant="body2">
										暂无校验摘要。
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

export function OfficialWebTargetJobShowPage() {
	return (
		<Show title="官网目标任务详情">
			<OfficialWebTargetJobShowContent />
		</Show>
	);
}
