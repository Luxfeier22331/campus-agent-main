import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	Divider,
	Drawer,
	MenuItem,
	Stack,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	TextField,
	Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import { PanelLineChart } from "../../panel-chart";
import { formatPanelTimestamp, PANEL_COPY } from "../../panel-copy";
import { PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS } from "../../panel-select";
import { formatSelectedTargetLabel, formatSurfaceLabel } from "../../requests/request-formatters";
import { buildRequestShowPath } from "../../requests/request-routes";
import type {
	OperatorOverviewWindow,
	OperatorQualityBadcaseRecord,
	OperatorQualityEvalCandidateRecord,
} from "../../types";
import {
	formatQualityBadcaseCauseClass,
	formatQualityBadcaseDetectedBy,
	formatQualityBadcaseStatus,
	formatQualityEvalCandidateSource,
} from "../quality-domain";
import { SafeExternalLink } from "../safe-external-link";
import {
	BADCASE_STATUS_OPTIONS,
	QUALITY_PAGE_SIZE_OPTIONS,
	QUALITY_SURFACE_OPTIONS,
	QUALITY_TARGET_OPTIONS,
	QUALITY_WINDOW_OPTIONS,
	type QualityFilterState,
} from "./constants";
import { EvalCandidateDiagnosticSummary } from "./eval-candidate-diagnostic-summary";
import {
	formatGradeScore,
	formatQualityWindowLabel,
	formatTrendBucketLabel,
	type QualitySummaryCard,
} from "./formatters";
import { SummaryCard } from "./summary-card";

function SectionCard(props: { children: ReactNode; description?: string; title: string }) {
	return (
		<Card
			sx={{
				backgroundColor: "background.paper",
				borderRadius: 2,
			}}
			variant="outlined"
		>
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

export function QualityHeaderSection(props: {
	asOf: string | null;
	filterSummaryItems: string[];
	filters: QualityFilterState;
	isRefreshing: boolean;
	onSelectedTargetChange(value: string): void;
	onSurfaceChange(value: string): void;
	onWindowChange(value: OperatorOverviewWindow): void;
}) {
	return (
		<Card
			sx={{
				backgroundColor: "background.paper",
				borderRadius: 2,
			}}
			variant="outlined"
		>
			<CardContent sx={{ p: { md: 2.5, xs: 2 }, "&:last-child": { pb: { md: 2.5, xs: 2 } } }}>
				<Stack spacing={2}>
					<Stack spacing={1}>
						<Typography sx={{ fontWeight: 700 }} variant="h5">
							{PANEL_COPY.qualityPage.title}
						</Typography>
						<Typography color="text.secondary" variant="body1">
							{PANEL_COPY.qualityPage.subtitle}
						</Typography>
					</Stack>

					<Stack
						direction={{ md: "row", xs: "column" }}
						spacing={1.5}
						sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
					>
						<TextField
							label={PANEL_COPY.qualityPage.filters.window}
							onChange={(event) =>
								props.onWindowChange(event.target.value as OperatorOverviewWindow)
							}
							select
							size="small"
							slotProps={PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 140, xs: "100%" } }}
							value={props.filters.window}
						>
							{QUALITY_WINDOW_OPTIONS.map((option) => (
								<MenuItem key={option.value} value={option.value}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.qualityPage.filters.surface}
							onChange={(event) => props.onSurfaceChange(event.target.value)}
							select
							size="small"
							slotProps={PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.surface ?? ""}
						>
							{QUALITY_SURFACE_OPTIONS.map((option) => (
								<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.qualityPage.filters.selectedTarget}
							onChange={(event) => props.onSelectedTargetChange(event.target.value)}
							select
							size="small"
							slotProps={PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.selectedTarget ?? ""}
						>
							{QUALITY_TARGET_OPTIONS.map((option) => (
								<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<Stack spacing={0.5}>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.qualityPage.asOf}
							</Typography>
							<Typography sx={{ fontWeight: 600 }} variant="body2">
								{props.asOf ? formatPanelTimestamp(props.asOf) : PANEL_COPY.pending}
							</Typography>
						</Stack>
					</Stack>

					<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
						{props.filterSummaryItems.map((item) => (
							<Chip key={item} label={item} size="small" variant="outlined" />
						))}
						{props.isRefreshing ? (
							<Chip
								color="info"
								label={PANEL_COPY.qualityPage.refreshing}
								size="small"
								variant="outlined"
							/>
						) : null}
					</Stack>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function QualitySummaryGrid(props: { cards: QualitySummaryCard[] }) {
	if (props.cards.length === 0) {
		return null;
	}

	return (
		<Box
			sx={{
				display: "grid",
				gap: 2,
				gridTemplateColumns: {
					lg: "repeat(3, minmax(0, 1fr))",
					md: "repeat(2, minmax(0, 1fr))",
					xs: "1fr",
				},
			}}
		>
			{props.cards.map((card) => (
				<SummaryCard detail={card.detail} key={card.label} label={card.label} value={card.value} />
			))}
		</Box>
	);
}

export function QualityInsightSections(props: {
	refusalEntries: ReadonlyArray<{
		count: number;
		key: string;
		label: string;
	}>;
	sampledCards: QualitySummaryCard[];
	summaryHasSampledGrades: boolean;
	timeseriesErrorMessage: string | null;
	trendSeries: Array<{
		bucketEnd: string;
		citationMissRatePct: number | null;
		emptyRecallRatePct: number | null;
		feedbackCoverageRatePct: number | null;
		feedbackHelpfulRatePct: number | null;
		feedbackUnhelpfulRatePct: number | null;
		needsClarificationRatePct: number | null;
		noAnswerRatePct: number | null;
		sampledGroundingPassRatePct: number | null;
	}>;
}) {
	return (
		<Box
			sx={{
				display: "grid",
				gap: 2,
				gridTemplateColumns: {
					xl: "1.2fr 1fr",
					xs: "1fr",
				},
			}}
		>
			<SectionCard
				description={PANEL_COPY.overviewPage.trends.qualitySummary}
				title={PANEL_COPY.qualityPage.trends.runtime}
			>
				{props.timeseriesErrorMessage ? (
					<Alert severity="error">{props.timeseriesErrorMessage}</Alert>
				) : props.trendSeries.length > 0 ? (
					<Stack spacing={3}>
						<PanelLineChart
							height={320}
							margin={{ bottom: 32, left: 40, right: 24, top: 24 }}
							series={[
								{
									data: props.trendSeries.map((point) => point.emptyRecallRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.emptyRecallRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.citationMissRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.citationMissRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.needsClarificationRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.needsClarificationRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.noAnswerRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.noAnswerRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.feedbackCoverageRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.feedbackCoverageRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.feedbackHelpfulRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.feedbackHelpfulRate,
									showMark: false,
								},
								{
									data: props.trendSeries.map((point) => point.feedbackUnhelpfulRatePct),
									label: PANEL_COPY.qualityPage.qualitySeries.feedbackUnhelpfulRate,
									showMark: false,
								},
							]}
							xAxis={[
								{
									data: props.trendSeries.map((point) => formatTrendBucketLabel(point.bucketEnd)),
									scaleType: "point",
								},
							]}
						/>
						<Divider />
						<Stack spacing={1}>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.qualityPage.trends.sampledGroundingOnly}
							</Typography>
							<PanelLineChart
								height={180}
								margin={{ bottom: 24, left: 40, right: 16, top: 12 }}
								series={[
									{
										data: props.trendSeries.map((point) => point.sampledGroundingPassRatePct),
										label: PANEL_COPY.qualityPage.qualitySeries.sampledGroundingPassRate,
										showMark: false,
									},
								]}
								xAxis={[
									{
										data: props.trendSeries.map((point) => formatTrendBucketLabel(point.bucketEnd)),
										scaleType: "point",
									},
								]}
							/>
						</Stack>
					</Stack>
				) : (
					<Alert severity="info">{PANEL_COPY.qualityPage.trends.empty}</Alert>
				)}
			</SectionCard>

			<SectionCard title={PANEL_COPY.qualityPage.sections.sampledSummary}>
				{props.summaryHasSampledGrades ? (
					<Stack spacing={2}>
						<Box
							sx={{
								display: "grid",
								gap: 2,
								gridTemplateColumns: {
									xs: "1fr",
								},
							}}
						>
							{props.sampledCards.map((card) => (
								<SummaryCard
									detail={card.detail}
									key={card.label}
									label={card.label}
									value={card.value}
								/>
							))}
						</Box>
					</Stack>
				) : (
					<Alert severity="info">{PANEL_COPY.qualityPage.cardDetail.sampledGradesMissing}</Alert>
				)}
				{props.refusalEntries.length > 0 ? (
					<>
						<Divider />
						<Stack spacing={1}>
							<Typography sx={{ fontWeight: 600 }} variant="body2">
								{PANEL_COPY.qualityPage.cards.requestCount}
							</Typography>
							<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
								{props.refusalEntries.map((entry) => (
									<Chip
										key={entry.key}
										label={`${entry.label} ${entry.count}`}
										variant="outlined"
									/>
								))}
							</Stack>
						</Stack>
					</>
				) : null}
			</SectionCard>
		</Box>
	);
}

export function QualityQueueSection(props: {
	badcaseErrorMessage: string | null;
	badcases: OperatorQualityBadcaseRecord[];
	hasNextPage: boolean;
	isPageChanging: boolean;
	isPending: boolean;
	onCauseClassChange(value: string): void;
	onDetectedByChange(value: string): void;
	onNextPage(): void;
	onPreviousPage(): void;
	onPerPageChange(value: number): void;
	onSelectBadcase(badcase: OperatorQualityBadcaseRecord): void;
	onStatusChange(value: string): void;
	pageDescription: string;
	queueFilters: Pick<
		QualityFilterState,
		"badcaseCauseClass" | "badcaseDetectedBy" | "badcaseStatus" | "perPage" | "page"
	>;
}) {
	return (
		<SectionCard
			description={PANEL_COPY.qualityPage.queue.queueHint}
			title={PANEL_COPY.qualityPage.sections.queue}
		>
			<Stack
				direction={{ lg: "row", xs: "column" }}
				spacing={1.5}
				sx={{ alignItems: { lg: "center", xs: "stretch" }, flexWrap: "wrap" }}
			>
				<TextField
					label={PANEL_COPY.qualityPage.filters.status}
					onChange={(event) => props.onStatusChange(event.target.value)}
					select
					size="small"
					slotProps={PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS}
					value={props.queueFilters.badcaseStatus}
				>
					{BADCASE_STATUS_OPTIONS.map((option) => (
						<MenuItem key={option.value || "all"} value={option.value}>
							{option.label}
						</MenuItem>
					))}
				</TextField>
				<TextField
					label={PANEL_COPY.qualityPage.filters.causeClass}
					onChange={(event) => props.onCauseClassChange(event.target.value)}
					size="small"
					value={props.queueFilters.badcaseCauseClass}
				/>
				<TextField
					label={PANEL_COPY.qualityPage.filters.detectedBy}
					onChange={(event) => props.onDetectedByChange(event.target.value)}
					size="small"
					value={props.queueFilters.badcaseDetectedBy}
				/>
				<TextField
					label={PANEL_COPY.qualityPage.queue.rowsPerPage}
					onChange={(event) => props.onPerPageChange(Number(event.target.value))}
					select
					size="small"
					slotProps={PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS}
					value={String(props.queueFilters.perPage)}
				>
					{QUALITY_PAGE_SIZE_OPTIONS.map((option) => (
						<MenuItem key={option} value={String(option)}>
							{option}
						</MenuItem>
					))}
				</TextField>
			</Stack>

			{props.badcaseErrorMessage ? (
				<Alert severity="error">{props.badcaseErrorMessage}</Alert>
			) : null}

			{!props.badcaseErrorMessage && props.badcases.length === 0 && !props.isPending ? (
				<Alert severity="info">{PANEL_COPY.qualityPage.queue.empty}</Alert>
			) : null}

			{props.badcases.length > 0 ? (
				<Box sx={{ overflowX: "auto" }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.openedAt}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.summary}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.causeClass}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.detectedBy}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.status}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.surface}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.selectedTarget}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.requestId}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.runId}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.actions}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{props.badcases.map((badcase) => (
								<TableRow hover key={badcase.id}>
									<TableCell>{formatPanelTimestamp(badcase.openedAt)}</TableCell>
									<TableCell sx={{ maxWidth: 320 }}>
										<Typography variant="body2">{badcase.summary}</Typography>
									</TableCell>
									<TableCell>{formatQualityBadcaseCauseClass(badcase.causeClass)}</TableCell>
									<TableCell>{formatQualityBadcaseDetectedBy(badcase.detectedBy)}</TableCell>
									<TableCell>{formatQualityBadcaseStatus(badcase.status)}</TableCell>
									<TableCell>{formatSurfaceLabel(badcase.surface)}</TableCell>
									<TableCell>{formatSelectedTargetLabel(badcase.selectedTarget)}</TableCell>
									<TableCell>{badcase.requestId}</TableCell>
									<TableCell>{badcase.runId ?? PANEL_COPY.pending}</TableCell>
									<TableCell>
										<Button
											onClick={() => props.onSelectBadcase(badcase)}
											size="small"
											variant="outlined"
										>
											{PANEL_COPY.qualityPage.queue.detail}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Box>
			) : null}

			<Stack
				direction={{ md: "row", xs: "column" }}
				justifyContent="space-between"
				spacing={1.5}
				sx={{ alignItems: { md: "center", xs: "stretch" } }}
			>
				<Typography color="text.secondary" variant="body2">
					{props.pageDescription}
				</Typography>
				<Stack direction="row" spacing={1}>
					<Button
						disabled={props.isPageChanging || props.queueFilters.page <= 1}
						onClick={props.onPreviousPage}
						variant="outlined"
					>
						{PANEL_COPY.qualityPage.queue.previousPage}
					</Button>
					<Button
						disabled={props.isPageChanging || !props.hasNextPage}
						onClick={props.onNextPage}
						variant="contained"
					>
						{PANEL_COPY.qualityPage.queue.nextPage}
					</Button>
				</Stack>
			</Stack>
		</SectionCard>
	);
}

export function QualityEvalCandidateSection(props: {
	candidates: OperatorQualityEvalCandidateRecord[];
	errorMessage: string | null;
	hasNextPage: boolean;
	isPageChanging: boolean;
	isPending: boolean;
	onNextPage(): void;
	onPreviousPage(): void;
	pageDescription: string;
	queueFilters: Pick<QualityFilterState, "evalPage">;
}) {
	return (
		<SectionCard
			description={PANEL_COPY.qualityPage.queue.evalCandidatesHint}
			title={PANEL_COPY.qualityPage.sections.evalCandidates}
		>
			{props.errorMessage ? <Alert severity="error">{props.errorMessage}</Alert> : null}

			{!props.errorMessage && props.candidates.length === 0 && !props.isPending ? (
				<Alert severity="info">{PANEL_COPY.qualityPage.queue.evalCandidatesEmpty}</Alert>
			) : null}

			{props.candidates.length > 0 ? (
				<Box sx={{ overflowX: "auto" }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>候选 ID</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.summary}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.causeClass}</TableCell>
								<TableCell>来源</TableCell>
								<TableCell>复核标签</TableCell>
								<TableCell>建议评测族</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.surface}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.selectedTarget}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.requestId}</TableCell>
								<TableCell>{PANEL_COPY.qualityPage.queueColumns.runId}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{props.candidates.map((candidate) => (
								<TableRow hover key={candidate.id}>
									<TableCell>{candidate.candidateId}</TableCell>
									<TableCell sx={{ maxWidth: 320 }}>
										<Typography variant="body2">{candidate.summary}</Typography>
										<EvalCandidateDiagnosticSummary candidate={candidate} />
									</TableCell>
									<TableCell>{formatQualityBadcaseCauseClass(candidate.causeClass)}</TableCell>
									<TableCell>{formatQualityEvalCandidateSource(candidate.intake.source)}</TableCell>
									<TableCell>
										{candidate.review && candidate.review.suggestedLabels.length > 0
											? candidate.review.suggestedLabels.join(", ")
											: "待标注"}
									</TableCell>
									<TableCell>{candidate.intake.suggestedEvalFamily}</TableCell>
									<TableCell>{formatSurfaceLabel(candidate.surface)}</TableCell>
									<TableCell>{formatSelectedTargetLabel(candidate.selectedTarget)}</TableCell>
									<TableCell>
										{candidate.requestId ? (
											<Button
												component={RouterLink}
												size="small"
												to={buildRequestShowPath(candidate.requestId)}
												variant="outlined"
											>
												{candidate.requestId}
											</Button>
										) : (
											candidate.diagnostic?.caseId
										)}
									</TableCell>
									<TableCell>{candidate.runId ?? PANEL_COPY.pending}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Box>
			) : null}

			<Stack
				direction={{ md: "row", xs: "column" }}
				justifyContent="space-between"
				spacing={1.5}
				sx={{ alignItems: { md: "center", xs: "stretch" } }}
			>
				<Typography color="text.secondary" variant="body2">
					{props.pageDescription}
				</Typography>
				<Stack direction="row" spacing={1}>
					<Button
						disabled={props.isPageChanging || props.queueFilters.evalPage <= 1}
						onClick={props.onPreviousPage}
						variant="outlined"
					>
						{PANEL_COPY.qualityPage.queue.previousPage}
					</Button>
					<Button
						disabled={props.isPageChanging || !props.hasNextPage}
						onClick={props.onNextPage}
						variant="contained"
					>
						{PANEL_COPY.qualityPage.queue.nextPage}
					</Button>
				</Stack>
			</Stack>
		</SectionCard>
	);
}

export function QualityDetailDrawer(props: {
	onClose(): void;
	selectedBadcase: OperatorQualityBadcaseRecord | null;
}) {
	return (
		<Drawer anchor="right" onClose={props.onClose} open={Boolean(props.selectedBadcase)}>
			<Box sx={{ p: 3, width: { sm: 420, xs: 320 } }}>
				<Stack spacing={2}>
					<Stack
						direction="row"
						justifyContent="space-between"
						spacing={1}
						sx={{ alignItems: "center" }}
					>
						<Typography sx={{ fontWeight: 700 }} variant="h6">
							{props.selectedBadcase?.summary ?? PANEL_COPY.qualityPage.sections.queue}
						</Typography>
						<Button onClick={props.onClose} size="small">
							{PANEL_COPY.qualityPage.queue.closeDetail}
						</Button>
					</Stack>

					{props.selectedBadcase ? (
						<>
							<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
								<Chip
									label={formatQualityBadcaseStatus(props.selectedBadcase.status)}
									size="small"
									variant="outlined"
								/>
								<Chip
									label={formatQualityBadcaseCauseClass(props.selectedBadcase.causeClass)}
									size="small"
									variant="outlined"
								/>
								<Chip
									label={formatQualityBadcaseDetectedBy(props.selectedBadcase.detectedBy)}
									size="small"
									variant="outlined"
								/>
							</Stack>

							<Divider />

							<Stack spacing={0.75}>
								<Typography sx={{ fontWeight: 600 }} variant="body2">
									{PANEL_COPY.qualityPage.detail.grader}
								</Typography>
								{props.selectedBadcase.grade ? (
									<>
										<Typography variant="body2">
											{props.selectedBadcase.grade.result} ·{" "}
											{formatGradeScore(props.selectedBadcase.grade.score)}
										</Typography>
										<Typography color="text.secondary" variant="body2">
											{props.selectedBadcase.grade.graderVersion}
										</Typography>
									</>
								) : (
									<Alert severity="info">{PANEL_COPY.qualityPage.detail.noGrade}</Alert>
								)}
							</Stack>

							<Divider />

							<Stack spacing={0.75}>
								<Typography sx={{ fontWeight: 600 }} variant="body2">
									{PANEL_COPY.qualityPage.detail.requestMeta}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.qualityPage.queueColumns.requestId}</strong>:{" "}
									{props.selectedBadcase.requestId}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.qualityPage.queueColumns.runId}</strong>:{" "}
									{props.selectedBadcase.runId ?? PANEL_COPY.pending}
								</Typography>
								<Typography variant="body2">
									<strong>Trace ID</strong>: {props.selectedBadcase.traceId}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.qualityPage.queueColumns.surface}</strong>:{" "}
									{formatSurfaceLabel(props.selectedBadcase.surface)}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.qualityPage.queueColumns.selectedTarget}</strong>:{" "}
									{formatSelectedTargetLabel(props.selectedBadcase.selectedTarget)}
								</Typography>
							</Stack>

							<Divider />

							<Stack spacing={1}>
								<Button
									component={RouterLink}
									to={buildRequestShowPath(props.selectedBadcase.requestId)}
									variant="contained"
								>
									{PANEL_COPY.qualityPage.queue.viewRequest}
								</Button>
								<SafeExternalLink
									unsafeHref={props.selectedBadcase.links.traceLink}
									label={PANEL_COPY.qualityPage.detail.traceLink}
								/>
								<SafeExternalLink
									unsafeHref={props.selectedBadcase.links.issueLink}
									label={PANEL_COPY.qualityPage.detail.issueLink}
								/>
								{props.selectedBadcase.links.issueFingerprint ? (
									<Typography color="text.secondary" variant="body2">
										{PANEL_COPY.qualityPage.detail.issueFingerprint}:{" "}
										{props.selectedBadcase.links.issueFingerprint}
									</Typography>
								) : null}
							</Stack>
						</>
					) : null}
				</Stack>
			</Box>
		</Drawer>
	);
}

export function buildQualityFilterSummaryItems(filters: QualityFilterState): string[] {
	return [
		`${PANEL_COPY.qualityPage.filterSummary.window}: ${formatQualityWindowLabel(filters.window)}`,
		`${PANEL_COPY.qualityPage.filterSummary.surface}: ${
			filters.surface
				? formatSurfaceLabel(filters.surface)
				: PANEL_COPY.overviewPage.filters.allSurfaces
		}`,
		`${PANEL_COPY.qualityPage.filterSummary.selectedTarget}: ${
			filters.selectedTarget
				? formatSelectedTargetLabel(filters.selectedTarget)
				: PANEL_COPY.overviewPage.filters.allTargets
		}`,
	];
}
