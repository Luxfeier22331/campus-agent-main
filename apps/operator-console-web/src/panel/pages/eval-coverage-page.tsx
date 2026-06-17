import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	Stack,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import type { OperatorConsoleDataProvider } from "../data-provider";
import { formatPanelTimestamp, PANEL_COPY, translateRuntimeErrorMessage } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OperatorEvalCoverageRecord, OperatorEvalCoverageSurfaceRecord } from "../types";
import {
	buildEvalCoverageSummary,
	buildRagasDiagnosticStageEntries,
	causeClassForRagasDiagnosticFailureStage,
	formatEvalCoverageDiagnosticStatus,
	formatEvalCoverageReadinessStatus,
	formatEvalCoverageSurfaceLabel,
	formatRagasDiagnosticMetricSummary,
	formatRagasDiagnosticStageLabel,
} from "./eval-coverage-domain";

function formatCount(value: number) {
	return new Intl.NumberFormat("zh-CN").format(value);
}

function toQueryErrorMessage(error: unknown, defaultMessage: string) {
	if (!error || typeof error !== "object") {
		return defaultMessage;
	}
	const maybeError = error as {
		body?: {
			error?: {
				code?: string | null;
				message?: string | null;
			};
		};
		message?: string | null;
		statusText?: string;
	};
	return translateRuntimeErrorMessage({
		code: maybeError.body?.error?.code,
		message: maybeError.body?.error?.message ?? maybeError.message,
		statusText: maybeError.statusText,
	});
}

function getQueryErrorCode(error: unknown) {
	if (!error || typeof error !== "object") {
		return null;
	}
	const maybeError = error as {
		body?: {
			error?: {
				code?: string | null;
			};
		};
	};
	return maybeError.body?.error?.code?.trim() || null;
}

function isEvalCoverageSnapshotNotPublished(error: unknown) {
	return getQueryErrorCode(error) === "eval_coverage_snapshot_not_found";
}

function SummaryCard(props: { detail: string; label: string; value: string }) {
	return (
		<Card sx={{ borderRadius: 2 }} variant="outlined">
			<CardContent>
				<Stack spacing={1}>
					<Typography color="text.secondary" variant="body2">
						{props.label}
					</Typography>
					<Typography sx={{ fontWeight: 700 }} variant="h5">
						{props.value}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						{props.detail}
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

function SectionCard(props: { children: ReactNode; description?: string; title: string }) {
	return (
		<Card sx={{ borderRadius: 2 }} variant="outlined">
			<CardContent>
				<Stack spacing={2}>
					<Stack spacing={0.75}>
						<Typography sx={{ fontWeight: 700 }} variant="h6">
							{props.title}
						</Typography>
						{props.description ? (
							<Typography color="text.secondary" variant="body2">
								{props.description}
							</Typography>
						) : null}
					</Stack>
					{props.children}
				</Stack>
			</CardContent>
		</Card>
	);
}

function statusChipColor(status: string) {
	if (status === "ready" || status === "passed" || status === "present") {
		return "success" as const;
	}
	if (status === "blocked" || status === "failed") {
		return "error" as const;
	}
	if (status === "diagnostic_attention") {
		return "warning" as const;
	}
	return "default" as const;
}

function buildQualityEvalCandidateFilterPath(surfaceKey: string, causeClass?: string) {
	const query = new URLSearchParams({
		detectedBy: "ragas_diagnostic",
		status: "pending_review",
		surface: surfaceKey,
		window: "30d",
	});
	if (causeClass) {
		query.set("causeClass", causeClass);
	}
	return `/observability/quality?${query.toString()}`;
}

function EvalCoverageSurfaceRows(props: { surfaces: OperatorEvalCoverageSurfaceRecord[] }) {
	return (
		<Box sx={{ overflowX: "auto" }}>
			<Table size="small">
				<TableHead>
					<TableRow>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.surface}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.qrels}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.expectedDocs}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.releaseAcceptance}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.answerQuality}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.goldenQrels}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.knownGap}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.ragasDiagnostic}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.ragasLowScore}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.ragasStages}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.lastGate}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.readiness}</TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{props.surfaces.map((surface) => (
						<TableRow key={surface.surfaceKey}>
							<TableCell>
								<Stack spacing={0.5}>
									<Typography sx={{ fontWeight: 700 }} variant="body2">
										{formatEvalCoverageSurfaceLabel(surface.surfaceKey)}
									</Typography>
									<Typography color="text.secondary" variant="caption">
										{surface.surfaceKey}
									</Typography>
								</Stack>
							</TableCell>
							<TableCell>{formatCount(surface.qrelsCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.uniqueExpectedDocCount)}</TableCell>
							<TableCell>{formatCount(surface.releaseAcceptanceCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.answerQualityCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.goldenQrelsCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.knownGapCaseCount)}</TableCell>
							<TableCell>
								<Stack spacing={0.5}>
									<Chip
										color={statusChipColor(surface.ragasDiagnostic.status)}
										label={formatEvalCoverageDiagnosticStatus(surface.ragasDiagnostic.status)}
										size="small"
									/>
									<Typography color="text.secondary" variant="caption">
										{`${surface.ragasDiagnostic.completedCaseCount}/${surface.ragasDiagnostic.caseCount} 个用例`}
									</Typography>
									<Typography color="text.secondary" variant="caption">
										{formatRagasDiagnosticMetricSummary(surface.ragasDiagnostic.metrics)}
									</Typography>
								</Stack>
							</TableCell>
							<TableCell>
								{surface.ragasDiagnostic.lowScoreCases.length > 0 ? (
									<Button
										component={RouterLink}
										size="small"
										to={buildQualityEvalCandidateFilterPath(surface.surfaceKey)}
										variant="outlined"
									>
										{formatCount(surface.ragasDiagnostic.lowScoreCases.length)}
									</Button>
								) : (
									"0"
								)}
							</TableCell>
							<TableCell>
								<Stack direction="row" flexWrap="wrap" gap={0.75}>
									{buildRagasDiagnosticStageEntries(surface.ragasDiagnostic).length > 0 ? (
										buildRagasDiagnosticStageEntries(surface.ragasDiagnostic).map((entry) => (
											<Chip
												component={RouterLink}
												key={entry.stage}
												label={`${entry.label} ${entry.count}`}
												size="small"
												to={buildQualityEvalCandidateFilterPath(
													surface.surfaceKey,
													causeClassForRagasDiagnosticFailureStage(entry.stage),
												)}
												variant="outlined"
											/>
										))
									) : (
										<Typography color="text.secondary" variant="caption">
											{PANEL_COPY.none}
										</Typography>
									)}
								</Stack>
							</TableCell>
							<TableCell>
								<Stack spacing={0.5}>
									<Chip
										color={statusChipColor(surface.lastGate.status)}
										label={surface.lastGate.status}
										size="small"
									/>
									<Typography color="text.secondary" variant="caption">
										{surface.lastGate.artifactId}
									</Typography>
								</Stack>
							</TableCell>
							<TableCell>
								<Stack spacing={0.5}>
									<Chip
										color={statusChipColor(surface.readiness.status)}
										label={formatEvalCoverageReadinessStatus(surface.readiness.status)}
										size="small"
									/>
									<Typography color="text.secondary" variant="caption">
										{surface.readiness.reasons.length > 0
											? surface.readiness.reasons.join(", ")
											: PANEL_COPY.none}
									</Typography>
								</Stack>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Box>
	);
}

function EvalCoverageDiagnosticDetails(props: { surfaces: OperatorEvalCoverageSurfaceRecord[] }) {
	return (
		<Stack spacing={2}>
			{props.surfaces.map((surface) => (
				<Card key={surface.surfaceKey} sx={{ borderRadius: 2 }} variant="outlined">
					<CardContent>
						<Stack spacing={1.5}>
							<Stack spacing={0.25}>
								<Typography sx={{ fontWeight: 700 }} variant="subtitle1">
									{formatEvalCoverageSurfaceLabel(surface.surfaceKey)}
								</Typography>
								<Typography color="text.secondary" variant="caption">
									{surface.surfaceKey}
								</Typography>
							</Stack>
							<Stack direction="row" flexWrap="wrap" gap={1}>
								<Chip label={`相关性 ${surface.qrelsCaseCount}`} size="small" />
								<Chip label={`期望文档 ${surface.uniqueExpectedDocCount}`} size="small" />
								<Chip label={`发布验收 ${surface.releaseAcceptanceCaseCount}`} size="small" />
								<Chip label={`答案质量 ${surface.answerQualityCaseCount}`} size="small" />
								<Chip label={`期望相关文档 ${surface.goldenQrelsCaseCount}`} size="small" />
								<Chip label={`已知缺口 ${surface.knownGapCaseCount}`} size="small" />
							</Stack>
							<Typography color="text.secondary" variant="body2">
								{`${PANEL_COPY.evalCoveragePage.fields.metricSummary}: ${formatRagasDiagnosticMetricSummary(
									surface.ragasDiagnostic.metrics,
								)}`}
							</Typography>
							<Stack direction="row" flexWrap="wrap" gap={1}>
								{buildRagasDiagnosticStageEntries(surface.ragasDiagnostic).length > 0 ? (
									buildRagasDiagnosticStageEntries(surface.ragasDiagnostic).map((entry) => (
										<Chip
											component={RouterLink}
											key={entry.stage}
											label={`${entry.label} ${entry.count}`}
											size="small"
											to={buildQualityEvalCandidateFilterPath(
												surface.surfaceKey,
												causeClassForRagasDiagnosticFailureStage(entry.stage),
											)}
											variant="outlined"
										/>
									))
								) : (
									<Chip label={PANEL_COPY.evalCoveragePage.fields.noStageFailures} size="small" />
								)}
							</Stack>
							{surface.ragasDiagnostic.lowScoreCases.length > 0 ? (
								<Box sx={{ overflowX: "auto" }}>
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>{PANEL_COPY.evalCoveragePage.columns.caseId}</TableCell>
												<TableCell>{PANEL_COPY.evalCoveragePage.columns.metric}</TableCell>
												<TableCell>{PANEL_COPY.evalCoveragePage.columns.score}</TableCell>
												<TableCell>{PANEL_COPY.evalCoveragePage.columns.failureStage}</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{surface.ragasDiagnostic.lowScoreCases.map((item) => (
												<TableRow key={`${item.caseId}:${item.metricName}`}>
													<TableCell>{item.caseId}</TableCell>
													<TableCell>{item.metricName}</TableCell>
													<TableCell>{item.score.toFixed(3)}</TableCell>
													<TableCell>
														{formatRagasDiagnosticStageLabel(item.failureStage)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</Box>
							) : (
								<Alert severity="info">{PANEL_COPY.evalCoveragePage.sections.noLowScore}</Alert>
							)}
						</Stack>
					</CardContent>
				</Card>
			))}
		</Stack>
	);
}

function EvalCoverageContent(props: { record: OperatorEvalCoverageRecord }) {
	const summary = useMemo(() => buildEvalCoverageSummary(props.record), [props.record]);

	return (
		<Stack spacing={3}>
			<Stack spacing={0.5}>
				<Typography variant="h5">{PANEL_COPY.evalCoveragePage.title}</Typography>
				<Typography color="text.secondary" variant="body2">
					{PANEL_COPY.evalCoveragePage.subtitle}
				</Typography>
				<Typography color="text.secondary" variant="caption">
					{`${PANEL_COPY.evalCoveragePage.generatedAt}: ${formatPanelTimestamp(
						props.record.generatedAt,
					)} · ${PANEL_COPY.evalCoveragePage.sourceGitHead}: ${props.record.sourceGitHead}`}
				</Typography>
			</Stack>

			<Box
				sx={{
					display: "grid",
					gap: 2,
					gridTemplateColumns: {
						lg: "repeat(4, minmax(0, 1fr))",
						sm: "repeat(2, minmax(0, 1fr))",
						xs: "1fr",
					},
				}}
			>
				<SummaryCard
					detail={`${summary.readySurfaceCount} 就绪 / ${summary.blockedSurfaceCount} 阻塞 / ${summary.diagnosticAttentionSurfaceCount} 需诊断`}
					label={PANEL_COPY.evalCoveragePage.cards.surfaceCount}
					value={formatCount(summary.surfaceCount)}
				/>
				<SummaryCard
					detail={PANEL_COPY.evalCoveragePage.cards.qrelsDetail}
					label={PANEL_COPY.evalCoveragePage.cards.qrelsCases}
					value={formatCount(summary.totalQrelsCases)}
				/>
				<SummaryCard
					detail={PANEL_COPY.evalCoveragePage.cards.releaseAcceptanceDetail}
					label={PANEL_COPY.evalCoveragePage.cards.releaseAcceptanceCases}
					value={formatCount(summary.totalReleaseAcceptanceCases)}
				/>
				<SummaryCard
					detail={`${PANEL_COPY.evalCoveragePage.cards.knownGapDetail}: ${formatCount(
						summary.totalKnownGapCases,
					)}`}
					label={PANEL_COPY.evalCoveragePage.cards.answerQualityCases}
					value={formatCount(summary.totalAnswerQualityCases)}
				/>
			</Box>

			<SectionCard
				description={PANEL_COPY.evalCoveragePage.sections.surfaceMatrixDescription}
				title={PANEL_COPY.evalCoveragePage.sections.surfaceMatrix}
			>
				<EvalCoverageSurfaceRows surfaces={props.record.surfaces} />
			</SectionCard>

			<SectionCard
				description={PANEL_COPY.evalCoveragePage.sections.diagnosticDescription}
				title={PANEL_COPY.evalCoveragePage.sections.diagnostic}
			>
				<EvalCoverageDiagnosticDetails surfaces={props.record.surfaces} />
			</SectionCard>

			<SectionCard
				description={PANEL_COPY.evalCoveragePage.sections.excludedDescription}
				title={PANEL_COPY.evalCoveragePage.sections.excluded}
			>
				{props.record.excludedSurfaces.length > 0 ? (
					<Stack direction="row" flexWrap="wrap" gap={1}>
						{props.record.excludedSurfaces.map((surface) => (
							<Chip
								key={surface.surfaceKey}
								label={`${surface.surfaceKey}: ${surface.reason}`}
								size="small"
								variant="outlined"
							/>
						))}
					</Stack>
				) : (
					<Alert severity="info">{PANEL_COPY.evalCoveragePage.sections.noExcluded}</Alert>
				)}
			</SectionCard>
		</Stack>
	);
}

export function EvalCoveragePage() {
	useAuthenticated();
	const dataProvider = useDataProvider<OperatorConsoleDataProvider>();
	const coverageQuery = useQuery({
		queryFn: ({ signal }) => dataProvider.getOperatorEvalCoverage({ signal }),
		queryKey: ["operator-console-eval-coverage"],
		staleTime: 60_000,
	});
	const snapshotNotPublished = isEvalCoverageSnapshotNotPublished(coverageQuery.error);
	const errorMessage =
		coverageQuery.error && !snapshotNotPublished
			? toQueryErrorMessage(coverageQuery.error, PANEL_COPY.evalCoveragePage.states.loadFailed)
			: null;

	return (
		<>
			<Title title={PANEL_COPY.menu.evalCoverage} />
			<PanelPage>
				{coverageQuery.isPending ? (
					<Alert severity="info">{PANEL_COPY.evalCoveragePage.states.loading}</Alert>
				) : null}
				{snapshotNotPublished ? (
					<Alert severity="info">{PANEL_COPY.evalCoveragePage.states.snapshotNotPublished}</Alert>
				) : null}
				{errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
				{coverageQuery.data?.data ? <EvalCoverageContent record={coverageQuery.data.data} /> : null}
			</PanelPage>
		</>
	);
}
