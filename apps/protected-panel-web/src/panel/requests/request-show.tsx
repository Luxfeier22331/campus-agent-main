import {
	Alert,
	Box,
	Card,
	CardContent,
	Chip,
	CircularProgress,
	Divider,
	Link,
	Stack,
	Typography,
} from "@mui/material";
import { type ReactNode, startTransition, useEffect, useRef, useState } from "react";
import { Show, useDataProvider, useRecordContext } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { formatPanelBoolean, formatPanelMicrousd, PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import { formatExternalHrefLabel, normalizeSafeExternalHref } from "../panel-safe-links";
import type { RequestProjectionRecord } from "../types";
import {
	buildRequestDiagnosticEntries,
	buildRequestIntentEntries,
	buildRequestReplayEntries,
	buildRequestRuntimeRunEntries,
	buildRequestStepTrajectoryEntries,
	buildRequestWorkflowTraceEntries,
	formatAclDecisionLabel,
	formatCapabilityLabel,
	formatDuration,
	formatPrincipalTypeLabel,
	formatSelectedTargetLabel,
	formatStatusLabel,
	formatSurfaceLabel,
	formatTimestamp,
} from "./request-formatters";
import {
	RequestActorSummary,
	RequestPreviewText,
	RequestScopeSummary,
	RequestSourceDocumentChips,
	RequestStatusChip,
} from "./request-presenters";

function linkValue(href: string | null, label: string) {
	const safeHref = normalizeSafeExternalHref(href);
	if (!safeHref) {
		return formatExternalHrefLabel(href);
	}

	return (
		<Link href={safeHref} rel="noopener noreferrer" target="_blank" underline="hover">
			{label}
		</Link>
	);
}

function RequestFieldRow(props: { label: string; value: ReactNode }) {
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

function RequestIntentEntryValue(props: { label: string; value: string }) {
	if (props.label === "开放状态" || props.label === "下一步动作") {
		return <Chip label={props.value} size="small" variant="outlined" />;
	}

	return props.value;
}

function RequestIntentSummary(props: {
	entries: Array<{ label: string; value: string }>;
	isLoading: boolean;
}) {
	if (props.isLoading) {
		return <RequestFieldRow label="意图识别" value={PANEL_COPY.pending} />;
	}

	if (props.entries.length === 0) {
		return <RequestFieldRow label="意图识别" value={PANEL_COPY.notAvailable} />;
	}

	return (
		<Stack spacing={1.25}>
			<Typography color="text.secondary" variant="caption">
				意图识别
			</Typography>
			<Box
				sx={{
					display: "grid",
					gap: 1.5,
					gridTemplateColumns: {
						md: "repeat(2, minmax(0, 1fr))",
						xs: "1fr",
					},
				}}
			>
				{props.entries.map((entry) => (
					<RequestFieldRow
						key={entry.label}
						label={entry.label}
						value={<RequestIntentEntryValue label={entry.label} value={entry.value} />}
					/>
				))}
			</Box>
		</Stack>
	);
}

function formatRecordSummary(record: Record<string, unknown> | null | undefined) {
	if (!record || Object.keys(record).length === 0) {
		return PANEL_COPY.none;
	}
	return Object.entries(record)
		.filter(([, value]) => typeof value === "string" || typeof value === "number")
		.map(([key, value]) => `${key}:${value}`)
		.join(" · ");
}

function RequestShowContent() {
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const record = useRecordContext<RequestProjectionRecord>();
	const [isObservabilityLoading, setIsObservabilityLoading] = useState(false);
	const [observabilityError, setObservabilityError] = useState<string | null>(null);
	const [observabilityRecord, setObservabilityRecord] = useState<
		Awaited<ReturnType<ProtectedPanelDataProvider["getRequestObservability"]>>["data"] | null
	>(null);
	const getRequestObservabilityRef = useRef(dataProvider.getRequestObservability);

	useEffect(() => {
		getRequestObservabilityRef.current = dataProvider.getRequestObservability;
	}, [dataProvider.getRequestObservability]);

	useEffect(() => {
		if (!record?.requestId) {
			return;
		}

		const controller = new AbortController();

		startTransition(() => {
			setIsObservabilityLoading(true);
			setObservabilityError(null);
			setObservabilityRecord(null);
		});

		void (async () => {
			try {
				const response = await getRequestObservabilityRef.current({
					requestId: record.requestId,
					signal: controller.signal,
				});
				if (controller.signal.aborted) {
					return;
				}

				startTransition(() => {
					setObservabilityRecord(response.data);
					setIsObservabilityLoading(false);
				});
			} catch (error) {
				if (controller.signal.aborted) {
					return;
				}

				startTransition(() => {
					setObservabilityError(error instanceof Error ? error.message : "加载请求观测详情失败。");
					setIsObservabilityLoading(false);
				});
			}
		})();

		return () => {
			controller.abort();
		};
	}, [record?.requestId]);

	if (!record) {
		return null;
	}

	const diagnosticEntries = buildRequestDiagnosticEntries(record.diagnostics);
	const observability = observabilityRecord?.observability ?? null;
	const tool = observability?.tool ?? null;
	const workflowTrace = observability?.workflowTrace ?? null;
	const links = observabilityRecord?.links ?? null;
	const auditSummary = observabilityRecord?.auditSummary ?? null;
	const intentEntries = buildRequestIntentEntries(observability?.intent);
	const runtimeRunEntries = buildRequestRuntimeRunEntries(observabilityRecord?.runtimeRun);
	const stepTrajectoryEntries = buildRequestStepTrajectoryEntries(
		observabilityRecord?.runtimeRun?.stepTrajectory,
	);
	const replayEntries = buildRequestReplayEntries(observabilityRecord?.replay);
	const workflowTraceEntries = buildRequestWorkflowTraceEntries(workflowTrace);

	return (
		<PanelPage>
			<Stack spacing={3}>
				<Alert severity="info">
					此视图展示 app-api 的请求投影快照。它被有意设计为读模型，而不是实时执行回放端点。
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
								<Typography variant="h6">身份标识</Typography>
								<Divider />
								<RequestFieldRow label="请求 ID" value={record.requestId} />
								<RequestFieldRow label="追踪 ID" value={record.traceId} />
								<RequestFieldRow
									label="状态"
									value={
										<Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
											<RequestStatusChip status={record.status} />
											<Typography color="text.secondary" variant="body2">
												{formatStatusLabel(record.status)}
											</Typography>
										</Stack>
									}
								/>
								<RequestFieldRow label="接入面" value={formatSurfaceLabel(record.surface)} />
								<RequestFieldRow
									label="会话"
									value={record.conversationId || PANEL_COPY.notAttached}
								/>
							</Stack>
						</CardContent>
					</Card>

					<Card>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">主体与路由</Typography>
								<Divider />
								<RequestFieldRow label="主体" value={<RequestActorSummary record={record} />} />
								<RequestFieldRow
									label="主体类型"
									value={formatPrincipalTypeLabel(record.principalType)}
								/>
								<RequestFieldRow
									label="能力"
									value={formatCapabilityLabel(record.requestedCapability)}
								/>
								<RequestFieldRow label="请求范围" value={<RequestScopeSummary record={record} />} />
								<RequestFieldRow
									label="选定目标"
									value={formatSelectedTargetLabel(record.selectedTarget)}
								/>
								<RequestIntentSummary entries={intentEntries} isLoading={isObservabilityLoading} />
							</Stack>
						</CardContent>
					</Card>

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">内容快照</Typography>
								<Divider />
								<RequestFieldRow
									label="问题预览"
									value={
										<RequestPreviewText
											emptyText="未记录问题预览。"
											text={record.questionPreview}
										/>
									}
								/>
								<RequestFieldRow
									label="回答预览"
									value={
										<RequestPreviewText emptyText="未记录回答预览。" text={record.answerPreview} />
									}
								/>
								<RequestFieldRow label="错误代码" value={record.errorCode || PANEL_COPY.none} />
								<RequestFieldRow
									label="来源文档"
									value={<RequestSourceDocumentChips sourceDocIds={record.sourceDocIds} />}
								/>
							</Stack>
						</CardContent>
					</Card>

					{diagnosticEntries.length > 0 ? (
						<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
							<CardContent>
								<Stack spacing={2}>
									<Typography variant="h6">诊断信息</Typography>
									<Divider />
									{diagnosticEntries.map((entry) => (
										<RequestFieldRow key={entry.label} label={entry.label} value={entry.value} />
									))}
								</Stack>
							</CardContent>
						</Card>
					) : null}

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">质量观测</Typography>
								<Divider />

								{isObservabilityLoading ? (
									<Stack alignItems="center" justifyContent="center" sx={{ minHeight: 160 }}>
										<CircularProgress size={28} />
									</Stack>
								) : null}

								{!isObservabilityLoading && observabilityError ? (
									<Alert severity="warning">{observabilityError}</Alert>
								) : null}

								{!isObservabilityLoading && observability ? (
									<Box
										sx={{
											display: "grid",
											gap: 2,
											gridTemplateColumns: {
												lg: "repeat(3, minmax(0, 1fr))",
												xs: "1fr",
											},
										}}
									>
										<Stack spacing={2}>
											<RequestFieldRow
												label="是否执行检索"
												value={formatPanelBoolean(observability.retrievalAttempted)}
											/>
											<RequestFieldRow
												label="候选数"
												value={observability.candidateCount ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="召回来源数"
												value={observability.retrievedSourceCount ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="是否空召回"
												value={formatPanelBoolean(observability.emptyRecall)}
											/>
											<RequestFieldRow
												label="检索充分性"
												value={observability.retrievalAdequacyVerdict || PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="检索原因"
												value={observability.retrievalAdequacyReason || PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="是否期望引用"
												value={formatPanelBoolean(observability.citationExpected)}
											/>
											<RequestFieldRow
												label="是否缺失引用"
												value={formatPanelBoolean(observability.citationMissing)}
											/>
											<RequestFieldRow
												label="引用数"
												value={observability.citationCount ?? PANEL_COPY.unknown}
											/>
										</Stack>

										<Stack spacing={2}>
											<RequestFieldRow
												label="模型"
												value={
													observability.model.provider || observability.model.name
														? `${observability.model.provider || PANEL_COPY.unknown} / ${observability.model.name || PANEL_COPY.unknown}`
														: PANEL_COPY.unknown
												}
											/>
											<RequestFieldRow
												label="输入 Tokens"
												value={observability.inputTokens ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="输出 Tokens"
												value={observability.outputTokens ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="缓存输入 Tokens"
												value={observability.cachedInputTokens ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="预估成本"
												value={formatPanelMicrousd(observability.estimatedCost.microusd)}
											/>
											<RequestFieldRow
												label="投影延迟"
												value={formatDuration(observability.projectionLagMs)}
											/>
											<RequestFieldRow
												label="观测时间"
												value={formatTimestamp(observability.measuredAt)}
											/>
											<RequestFieldRow
												label="版本查询"
												value={observability.versionQuerySummary || PANEL_COPY.none}
											/>
											<RequestFieldRow
												label="Prompt"
												value={
													observability.prompt?.id || observability.prompt?.version
														? `${observability.prompt.id || PANEL_COPY.unknown}@${observability.prompt.version || PANEL_COPY.unknown}`
														: PANEL_COPY.unknown
												}
											/>
										</Stack>

										<Stack spacing={2}>
											<RequestFieldRow
												label="ACL 判定"
												value={formatAclDecisionLabel(observability.aclDecision)}
											/>
											<RequestFieldRow
												label="ACL 异常"
												value={observability.aclAnomalyCode || PANEL_COPY.none}
											/>
											<RequestFieldRow
												label="是否 Fail Closed"
												value={formatPanelBoolean(observability.failClosed)}
											/>
											<RequestFieldRow
												label="拒答类别"
												value={observability.refusalClass || PANEL_COPY.none}
											/>
											<RequestFieldRow
												label="是否可追踪"
												value={formatPanelBoolean(observability.traceAvailable)}
											/>
											<RequestFieldRow
												label="Trace 链接"
												value={linkValue(links?.traceLink ?? null, "打开 trace")}
											/>
											<RequestFieldRow
												label="问题链接"
												value={linkValue(links?.issueLink ?? null, "打开问题")}
											/>
											<RequestFieldRow
												label="问题指纹"
												value={links?.issueFingerprint || PANEL_COPY.notAvailable}
											/>
											<RequestFieldRow
												label="审计事件数"
												value={auditSummary?.auditEventCount ?? PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="来源轨迹"
												value={
													observability.sourceTrace
														? `召回 ${observability.sourceTrace.retrieved.length} · 支撑 ${observability.sourceTrace.supporting.length}`
														: PANEL_COPY.unknown
												}
											/>
											<RequestFieldRow
												label="最近终态代码"
												value={auditSummary?.latestTerminalCode || PANEL_COPY.unknown}
											/>
										</Stack>
									</Box>
								) : null}
							</Stack>
						</CardContent>
					</Card>

					{runtimeRunEntries.length > 0 ? (
						<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
							<CardContent>
								<Stack spacing={2}>
									<Typography variant="h6">运行事实</Typography>
									<Typography color="text.secondary" variant="body2">
										RunEvent 与 Step 轨迹来自 sanitized projection；此区块不展示原始 payload、prompt
										或回答草稿。
									</Typography>
									<Divider />
									<Box
										sx={{
											display: "grid",
											gap: 2,
											gridTemplateColumns: {
												md: "repeat(4, minmax(0, 1fr))",
												xs: "1fr",
											},
										}}
									>
										{runtimeRunEntries.map((entry) => (
											<RequestFieldRow key={entry.label} label={entry.label} value={entry.value} />
										))}
									</Box>
									{stepTrajectoryEntries.length > 0 ? (
										<>
											<Divider />
											<Typography variant="subtitle2">Step 轨迹</Typography>
											<Box
												sx={{
													display: "grid",
													gap: 2,
													gridTemplateColumns: {
														md: "repeat(2, minmax(0, 1fr))",
														xs: "1fr",
													},
												}}
											>
												{stepTrajectoryEntries.map((entry) => (
													<RequestFieldRow
														key={entry.label}
														label={entry.label}
														value={entry.value}
													/>
												))}
											</Box>
										</>
									) : null}
								</Stack>
							</CardContent>
						</Card>
					) : null}

					{tool || workflowTrace ? (
						<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
							<CardContent>
								<Stack spacing={2}>
									<Typography variant="h6">编排观测</Typography>
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
										<Stack spacing={2}>
											<RequestFieldRow
												label="分支"
												value={workflowTrace?.directVsDelegateBranch || PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="规划结果"
												value={workflowTrace?.planningOutcome || PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="Trace 目标"
												value={formatSelectedTargetLabel(workflowTrace?.selectedTarget ?? null)}
											/>
										</Stack>
										<Stack spacing={2}>
											<RequestFieldRow
												label="Tool"
												value={
													tool?.selectedTool ||
													workflowTrace?.selectedTools.join(", ") ||
													PANEL_COPY.none
												}
											/>
											<RequestFieldRow
												label="Tool 结果"
												value={tool?.businessOutcome || PANEL_COPY.unknown}
											/>
											<RequestFieldRow
												label="Tool Fail Close"
												value={
													tool?.failCloseReason || workflowTrace?.failCloseReason || PANEL_COPY.none
												}
											/>
										</Stack>
										<Stack spacing={2}>
											<RequestFieldRow
												label="Guardrails"
												value={formatRecordSummary(workflowTrace?.guardrailOutcomes)}
											/>
											<RequestFieldRow
												label="上下文"
												value={formatRecordSummary(workflowTrace?.contextResolution)}
											/>
											<RequestFieldRow
												label="Handoff"
												value={formatRecordSummary(workflowTrace?.handoff)}
											/>
										</Stack>
									</Box>
									{workflowTraceEntries.length > 0 ? (
										<Box
											sx={{
												display: "grid",
												gap: 2,
												gridTemplateColumns: {
													md: "repeat(2, minmax(0, 1fr))",
													xs: "1fr",
												},
											}}
										>
											{workflowTraceEntries.map((entry) => (
												<RequestFieldRow
													key={entry.label}
													label={entry.label}
													value={entry.value}
												/>
											))}
										</Box>
									) : null}
								</Stack>
							</CardContent>
						</Card>
					) : null}

					{replayEntries.length > 0 ? (
						<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
							<CardContent>
								<Stack spacing={2}>
									<Typography variant="h6">回放摘要</Typography>
									<Divider />
									<Box
										sx={{
											display: "grid",
											gap: 2,
											gridTemplateColumns: {
												md: "repeat(4, minmax(0, 1fr))",
												xs: "1fr",
											},
										}}
									>
										{replayEntries.map((entry) => (
											<RequestFieldRow key={entry.label} label={entry.label} value={entry.value} />
										))}
									</Box>
								</Stack>
							</CardContent>
						</Card>
					) : null}

					<Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
						<CardContent>
							<Stack spacing={2}>
								<Typography variant="h6">时间线</Typography>
								<Divider />
								<Box
									sx={{
										display: "grid",
										gap: 2,
										gridTemplateColumns: {
											md: "repeat(4, minmax(0, 1fr))",
											xs: "1fr",
										},
									}}
								>
									<RequestFieldRow label="开始时间" value={formatTimestamp(record.startedAt)} />
									<RequestFieldRow label="完成时间" value={formatTimestamp(record.completedAt)} />
									<RequestFieldRow label="投影时间" value={formatTimestamp(record.projectedAt)} />
									<RequestFieldRow label="耗时" value={formatDuration(record.durationMs)} />
								</Box>
							</Stack>
						</CardContent>
					</Card>
				</Box>
			</Stack>
		</PanelPage>
	);
}

export function RequestShowPage() {
	return (
		<Show title="请求详情">
			<RequestShowContent />
		</Show>
	);
}
