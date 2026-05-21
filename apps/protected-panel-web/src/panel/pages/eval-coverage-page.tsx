import {
	Alert,
	Box,
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

import type { ProtectedPanelDataProvider } from "../data-provider";
import { formatPanelTimestamp, PANEL_COPY, translateRuntimeErrorMessage } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OperatorEvalCoverageRecord, OperatorEvalCoverageSurfaceRecord } from "../types";
import {
	buildEvalCoverageSummary,
	formatEvalCoverageDiagnosticStatus,
	formatEvalCoverageReadinessStatus,
	formatEvalCoverageSurfaceLabel,
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

function EvalCoverageSurfaceRows(props: { surfaces: OperatorEvalCoverageSurfaceRecord[] }) {
	return (
		<Box sx={{ overflowX: "auto" }}>
			<Table size="small">
				<TableHead>
					<TableRow>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.surface}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.qrels}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.releaseAcceptance}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.answerQuality}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.knownGap}</TableCell>
						<TableCell>{PANEL_COPY.evalCoveragePage.columns.ragasDiagnostic}</TableCell>
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
							<TableCell>{formatCount(surface.releaseAcceptanceCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.answerQualityCaseCount)}</TableCell>
							<TableCell>{formatCount(surface.knownGapCaseCount)}</TableCell>
							<TableCell>
								<Stack spacing={0.5}>
									<Chip
										color={statusChipColor(surface.ragasDiagnostic.status)}
										label={formatEvalCoverageDiagnosticStatus(surface.ragasDiagnostic.status)}
										size="small"
									/>
									<Typography color="text.secondary" variant="caption">
										{`${surface.ragasDiagnostic.completedCaseCount}/${surface.ragasDiagnostic.caseCount} cases`}
									</Typography>
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
					detail={`${summary.readySurfaceCount} ready / ${summary.blockedSurfaceCount} blocked / ${summary.diagnosticAttentionSurfaceCount} diagnostic`}
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
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const coverageQuery = useQuery({
		queryFn: ({ signal }) => dataProvider.getOperatorEvalCoverage({ signal }),
		queryKey: ["protected-panel-eval-coverage"],
		staleTime: 60_000,
	});
	const errorMessage = coverageQuery.error
		? toQueryErrorMessage(coverageQuery.error, PANEL_COPY.evalCoveragePage.states.loadFailed)
		: null;

	return (
		<>
			<Title title={PANEL_COPY.menu.evalCoverage} />
			<PanelPage>
				{coverageQuery.isPending ? (
					<Alert severity="info">{PANEL_COPY.evalCoveragePage.states.loading}</Alert>
				) : null}
				{errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
				{coverageQuery.data?.data ? <EvalCoverageContent record={coverageQuery.data.data} /> : null}
			</PanelPage>
		</>
	);
}
