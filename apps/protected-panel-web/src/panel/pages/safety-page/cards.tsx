import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	Drawer,
	MenuItem,
	Link as MuiLink,
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

import { formatPanelTimestamp, PANEL_COPY } from "../../panel-copy";
import { normalizeSafeExternalHref } from "../../panel-safe-links";
import {
	formatPrincipalTypeLabel,
	formatSelectedTargetLabel,
	formatSurfaceLabel,
} from "../../requests/request-formatters";
import type { OperatorOverviewWindow, OperatorSafetyAnomalyRecord } from "../../types";
import {
	buildSafetyPostureEntries,
	formatSafetyAnomalyCode,
	formatSafetyAnomalySeverity,
	formatSafetyAnomalyStatus,
} from "../safety-domain";
import {
	ANOMALY_SEVERITY_OPTIONS,
	ANOMALY_STATUS_OPTIONS,
	SAFETY_PAGE_SIZE_OPTIONS,
	SAFETY_SURFACE_OPTIONS,
	SAFETY_TARGET_OPTIONS,
	SAFETY_WINDOW_OPTIONS,
	type SafetyFilterState,
} from "./constants";
import {
	buildDecisionSummaryCards,
	buildPostureHint,
	formatSafetyWindowLabel,
	type SafetySummaryCard,
} from "./formatters";

function SummaryCard(props: { detail: string; label: string; value: string }) {
	return (
		<Card
			sx={{
				backgroundColor: "background.paper",
				borderRadius: 2,
			}}
			variant="outlined"
		>
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

function SafeExternalLink(props: { unsafeHref: string | null; label: string }) {
	const safeHref = normalizeSafeExternalHref(props.unsafeHref);
	if (!safeHref) {
		return null;
	}

	return (
		<MuiLink href={safeHref} rel="noreferrer" target="_blank">
			{props.label}
		</MuiLink>
	);
}

export function SafetyHeaderSection(props: {
	asOf: string | null;
	filterSummaryItems: string[];
	filters: SafetyFilterState;
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
							{PANEL_COPY.safetyPage.title}
						</Typography>
						<Typography color="text.secondary" variant="body1">
							{PANEL_COPY.safetyPage.subtitle}
						</Typography>
					</Stack>

					<Alert severity="info">{PANEL_COPY.safetyPage.summaryFilterHint}</Alert>

					<Stack
						direction={{ md: "row", xs: "column" }}
						spacing={1.5}
						sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
					>
						<TextField
							label={PANEL_COPY.safetyPage.filters.window}
							onChange={(event) =>
								props.onWindowChange(event.target.value as OperatorOverviewWindow)
							}
							select
							size="small"
							sx={{ width: { md: 140, xs: "100%" } }}
							value={props.filters.window}
						>
							{SAFETY_WINDOW_OPTIONS.map((option) => (
								<MenuItem key={option.value} value={option.value}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.safetyPage.filters.surface}
							onChange={(event) => props.onSurfaceChange(event.target.value)}
							select
							size="small"
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.surface ?? ""}
						>
							{SAFETY_SURFACE_OPTIONS.map((option) => (
								<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.safetyPage.filters.selectedTarget}
							onChange={(event) => props.onSelectedTargetChange(event.target.value)}
							select
							size="small"
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.selectedTarget ?? ""}
						>
							{SAFETY_TARGET_OPTIONS.map((option) => (
								<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</MenuItem>
							))}
						</TextField>
						<Stack spacing={0.5}>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.safetyPage.asOf}
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
								label={PANEL_COPY.safetyPage.refreshing}
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

export function SafetyDecisionSection(props: { cards: SafetySummaryCard[] }) {
	if (props.cards.length === 0) {
		return null;
	}

	return (
		<SectionCard
			description={PANEL_COPY.safetyPage.sections.decisionSummaryDescription}
			title={PANEL_COPY.safetyPage.sections.decisionSummary}
		>
			<Box
				sx={{
					display: "grid",
					gap: 2,
					gridTemplateColumns: {
						lg: "repeat(4, minmax(0, 1fr))",
						md: "repeat(2, minmax(0, 1fr))",
						xs: "1fr",
					},
				}}
			>
				{props.cards.map((card) => (
					<SummaryCard
						detail={card.detail}
						key={card.label}
						label={card.label}
						value={card.value}
					/>
				))}
			</Box>
		</SectionCard>
	);
}

export function SafetyPostureSection(props: {
	summary: import("../../types").OperatorSafetySummaryRecord | null;
}) {
	if (!props.summary) {
		return null;
	}

	const postureEntries = buildSafetyPostureEntries(props.summary.summary);

	return (
		<SectionCard
			description={PANEL_COPY.safetyPage.sections.postureDescription}
			title={PANEL_COPY.safetyPage.sections.posture}
		>
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
				{postureEntries.map((entry) => (
					<Card key={entry.key} variant="outlined">
						<CardContent>
							<Stack spacing={1.25}>
								<Stack
									direction="row"
									spacing={1}
									sx={{ alignItems: "center", justifyContent: "space-between" }}
								>
									<Typography sx={{ fontWeight: 700 }} variant="body1">
										{entry.label}
									</Typography>
									<Chip
										color={
											entry.tone === "warning"
												? "warning"
												: entry.tone === "info"
													? "info"
													: "success"
										}
										label={
											entry.tone === "warning"
												? PANEL_COPY.safetyPage.posture.attention
												: entry.tone === "info"
													? PANEL_COPY.safetyPage.posture.active
													: PANEL_COPY.safetyPage.posture.stable
										}
										size="small"
										variant={entry.tone === "success" ? "outlined" : "filled"}
									/>
								</Stack>
								<Typography sx={{ fontWeight: 700 }} variant="h5">
									{entry.value}
								</Typography>
								<Typography color="text.secondary" variant="body2">
									{entry.detail}
								</Typography>
								<Typography color="text.secondary" variant="body2">
									{buildPostureHint(entry.key, entry.tone)}
								</Typography>
							</Stack>
						</CardContent>
					</Card>
				))}
			</Box>
		</SectionCard>
	);
}

export function SafetyQueueSection(props: {
	anomalyErrorMessage: string | null;
	anomalies: OperatorSafetyAnomalyRecord[];
	hasNextPage: boolean;
	isPageChanging: boolean;
	isPending: boolean;
	onAnomalyCodeChange(value: string): void;
	onNextPage(): void;
	onPerPageChange(value: number): void;
	onPreviousPage(): void;
	onSelectAnomaly(anomaly: OperatorSafetyAnomalyRecord): void;
	onSeverityChange(value: string): void;
	onStatusChange(value: string): void;
	pageDescription: string;
	queueFilters: Pick<SafetyFilterState, "anomalyCode" | "page" | "perPage" | "severity" | "status">;
}) {
	return (
		<SectionCard
			description={PANEL_COPY.safetyPage.queue.queueHint}
			title={PANEL_COPY.safetyPage.sections.queue}
		>
			<Alert severity="info">{PANEL_COPY.safetyPage.queue.filterHint}</Alert>

			<Stack
				direction={{ md: "row", xs: "column" }}
				spacing={1.5}
				sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
			>
				<TextField
					label={PANEL_COPY.safetyPage.queue.filters.severity}
					onChange={(event) => props.onSeverityChange(event.target.value)}
					select
					size="small"
					sx={{ minWidth: 140 }}
					value={props.queueFilters.severity}
				>
					{ANOMALY_SEVERITY_OPTIONS.map((option) => (
						<MenuItem key={option.value || "all"} value={option.value}>
							{option.label}
						</MenuItem>
					))}
				</TextField>
				<TextField
					label={PANEL_COPY.safetyPage.queue.filters.status}
					onChange={(event) => props.onStatusChange(event.target.value)}
					select
					size="small"
					sx={{ minWidth: 140 }}
					value={props.queueFilters.status}
				>
					{ANOMALY_STATUS_OPTIONS.map((option) => (
						<MenuItem key={option.value || "all"} value={option.value}>
							{option.label}
						</MenuItem>
					))}
				</TextField>
				<TextField
					label={PANEL_COPY.safetyPage.queue.filters.anomalyCode}
					onChange={(event) => props.onAnomalyCodeChange(event.target.value)}
					placeholder={PANEL_COPY.safetyPage.queue.filters.anomalyCodePlaceholder}
					size="small"
					sx={{ minWidth: 220 }}
					value={props.queueFilters.anomalyCode}
				/>
				<TextField
					label={PANEL_COPY.safetyPage.queue.rowsPerPage}
					onChange={(event) => props.onPerPageChange(Number(event.target.value))}
					select
					size="small"
					sx={{ minWidth: 140 }}
					value={String(props.queueFilters.perPage)}
				>
					{SAFETY_PAGE_SIZE_OPTIONS.map((value) => (
						<MenuItem key={value} value={String(value)}>
							{value}
						</MenuItem>
					))}
				</TextField>
			</Stack>

			{props.anomalyErrorMessage ? (
				<Alert severity="error">{props.anomalyErrorMessage}</Alert>
			) : null}

			{!props.anomalyErrorMessage && props.anomalies.length === 0 && !props.isPending ? (
				<Alert severity="info">{PANEL_COPY.safetyPage.queue.empty}</Alert>
			) : null}

			{props.anomalies.length > 0 ? (
				<Box sx={{ overflowX: "auto" }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.detectedAt}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.summary}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.anomalyCode}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.severity}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.status}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.principalType}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.surface}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.selectedTarget}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.requestId}</TableCell>
								<TableCell>{PANEL_COPY.safetyPage.queueColumns.actions}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{props.anomalies.map((anomaly) => (
								<TableRow hover key={anomaly.id}>
									<TableCell>{formatPanelTimestamp(anomaly.detectedAt)}</TableCell>
									<TableCell>
										<Typography variant="body2">{anomaly.summary}</Typography>
									</TableCell>
									<TableCell>
										<Stack spacing={0.5}>
											<Typography variant="body2">
												{formatSafetyAnomalyCode(anomaly.anomalyCode)}
											</Typography>
											<Typography color="text.secondary" variant="caption">
												{anomaly.anomalyCode}
											</Typography>
										</Stack>
									</TableCell>
									<TableCell>{formatSafetyAnomalySeverity(anomaly.severity)}</TableCell>
									<TableCell>{formatSafetyAnomalyStatus(anomaly.status)}</TableCell>
									<TableCell>{formatPrincipalTypeLabel(anomaly.principalType)}</TableCell>
									<TableCell>{formatSurfaceLabel(anomaly.surface)}</TableCell>
									<TableCell>{formatSelectedTargetLabel(anomaly.selectedTarget)}</TableCell>
									<TableCell>{anomaly.requestId}</TableCell>
									<TableCell>
										<Button
											onClick={() => props.onSelectAnomaly(anomaly)}
											size="small"
											variant="text"
										>
											{PANEL_COPY.safetyPage.queue.detail}
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
				spacing={1.5}
				sx={{ alignItems: { md: "center", xs: "flex-start" }, justifyContent: "space-between" }}
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
						{PANEL_COPY.safetyPage.queue.previousPage}
					</Button>
					<Button
						disabled={props.isPageChanging || !props.hasNextPage}
						onClick={props.onNextPage}
						variant="contained"
					>
						{PANEL_COPY.safetyPage.queue.nextPage}
					</Button>
				</Stack>
			</Stack>
		</SectionCard>
	);
}

export function SafetyDetailDrawer(props: {
	onClose(): void;
	selectedAnomaly: OperatorSafetyAnomalyRecord | null;
}) {
	return (
		<Drawer anchor="right" onClose={props.onClose} open={Boolean(props.selectedAnomaly)}>
			<Box sx={{ p: 3, width: { sm: 420, xs: "100vw" } }}>
				<Stack spacing={2.5}>
					<Stack
						direction="row"
						spacing={1}
						sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
					>
						<Stack spacing={0.75}>
							<Typography sx={{ fontWeight: 700 }} variant="h6">
								{props.selectedAnomaly?.summary ?? PANEL_COPY.safetyPage.sections.queue}
							</Typography>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.safetyPage.detail.summaryHint}
							</Typography>
						</Stack>
						<Button onClick={props.onClose} size="small" variant="outlined">
							{PANEL_COPY.safetyPage.queue.closeDetail}
						</Button>
					</Stack>

					{props.selectedAnomaly ? (
						<>
							<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
								<Chip
									label={formatSafetyAnomalySeverity(props.selectedAnomaly.severity)}
									size="small"
								/>
								<Chip
									label={formatSafetyAnomalyStatus(props.selectedAnomaly.status)}
									size="small"
									variant="outlined"
								/>
								<Chip
									label={formatSafetyAnomalyCode(props.selectedAnomaly.anomalyCode)}
									size="small"
									variant="outlined"
								/>
							</Stack>

							<SectionCard title={PANEL_COPY.safetyPage.detail.requestMeta}>
								<Stack spacing={1.25}>
									<Typography variant="body2">
										<strong>{PANEL_COPY.safetyPage.queueColumns.requestId}</strong>:{" "}
										{props.selectedAnomaly.requestId}
									</Typography>
									<Typography variant="body2">
										<strong>Trace ID</strong>: {props.selectedAnomaly.traceId}
									</Typography>
									<Typography variant="body2">
										<strong>{PANEL_COPY.safetyPage.queueColumns.principalType}</strong>:{" "}
										{formatPrincipalTypeLabel(props.selectedAnomaly.principalType)}
									</Typography>
									<Typography variant="body2">
										<strong>{PANEL_COPY.safetyPage.queueColumns.surface}</strong>:{" "}
										{formatSurfaceLabel(props.selectedAnomaly.surface)}
									</Typography>
									<Typography variant="body2">
										<strong>{PANEL_COPY.safetyPage.queueColumns.selectedTarget}</strong>:{" "}
										{formatSelectedTargetLabel(props.selectedAnomaly.selectedTarget)}
									</Typography>
									<Typography variant="body2">
										<strong>{PANEL_COPY.safetyPage.queueColumns.detectedAt}</strong>:{" "}
										{formatPanelTimestamp(props.selectedAnomaly.detectedAt)}
									</Typography>
								</Stack>
							</SectionCard>

							<SectionCard title={PANEL_COPY.safetyPage.detail.links}>
								<Stack spacing={1.25}>
									<Button
										component={RouterLink}
										size="small"
										to={`/requests/${props.selectedAnomaly.requestId}/show`}
										variant="contained"
									>
										{PANEL_COPY.safetyPage.queue.viewRequest}
									</Button>
									<SafeExternalLink
										unsafeHref={props.selectedAnomaly.links.traceLink}
										label={PANEL_COPY.safetyPage.detail.traceLink}
									/>
									<SafeExternalLink
										unsafeHref={props.selectedAnomaly.links.issueLink}
										label={PANEL_COPY.safetyPage.detail.issueLink}
									/>
									{props.selectedAnomaly.links.issueFingerprint ? (
										<Typography color="text.secondary" variant="body2">
											{PANEL_COPY.safetyPage.detail.issueFingerprint}:{" "}
											{props.selectedAnomaly.links.issueFingerprint}
										</Typography>
									) : null}
								</Stack>
							</SectionCard>
						</>
					) : null}
				</Stack>
			</Box>
		</Drawer>
	);
}

export function buildSafetyFilterSummaryItems(filters: SafetyFilterState): string[] {
	return [
		`${PANEL_COPY.safetyPage.filterSummary.window}: ${formatSafetyWindowLabel(filters.window)}`,
		`${PANEL_COPY.safetyPage.filterSummary.surface}: ${
			filters.surface
				? formatSurfaceLabel(filters.surface)
				: PANEL_COPY.overviewPage.filters.allSurfaces
		}`,
		`${PANEL_COPY.safetyPage.filterSummary.selectedTarget}: ${
			filters.selectedTarget
				? formatSelectedTargetLabel(filters.selectedTarget)
				: PANEL_COPY.overviewPage.filters.allTargets
		}`,
	];
}

export function buildSafetyDecisionCards(
	summary: import("../../types").OperatorSafetySummaryRecord | null,
): SafetySummaryCard[] {
	return summary ? buildDecisionSummaryCards(summary.summary) : [];
}
