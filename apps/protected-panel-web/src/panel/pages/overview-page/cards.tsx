import {
	Alert,
	Box,
	Card,
	CardContent,
	Chip,
	Divider,
	Skeleton,
	Stack,
	TextField,
	Typography,
} from "@mui/material";
import type { ReactNode } from "react";

import { PanelLineChart } from "../../panel-chart";
import { formatPanelTimestamp, PANEL_COPY } from "../../panel-copy";
import { PANEL_NATIVE_SELECT_EMPTY_VALUE_SLOT_PROPS } from "../../panel-select";
import { formatSelectedCapabilityLabel, formatSurfaceLabel } from "../../requests/request-formatters";
import type {
	OperatorOverviewAlert,
	OperatorOverviewRecord,
	PanelOverviewRecord,
} from "../../types";
import type { OverviewFilterState } from "./constants";
import { OVERVIEW_WINDOW_OPTIONS, SURFACE_OPTIONS, TARGET_OPTIONS } from "./constants";
import {
	buildOverviewCards,
	formatAlertDomain,
	formatAlertSeverity,
	formatAlertTitle,
	formatCount,
	formatOverviewWindowLabel,
	formatPrincipalClass,
	formatTrendBucketLabel,
	renderDomainStatus,
} from "./formatters";

export function OverviewMetricCard(props: { detail: string; label: string; value: string }) {
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

export function OverviewChartCard(props: {
	children: ReactNode;
	description?: string;
	title: string;
}) {
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

export function OverviewAlertCard(props: { alert: OperatorOverviewAlert }) {
	return (
		<Card variant="outlined">
			<CardContent>
				<Stack spacing={1.5}>
					<Stack direction={{ sm: "row", xs: "column" }} justifyContent="space-between" spacing={1}>
						<Stack spacing={0.5}>
							<Typography sx={{ fontWeight: 700 }} variant="subtitle1">
								{formatAlertTitle(props.alert.code)}
							</Typography>
							<Typography color="text.secondary" variant="body2">
								{props.alert.code}
							</Typography>
						</Stack>
						<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
							<Chip
								color={props.alert.severity === "high" ? "error" : "warning"}
								label={`严重度 ${formatAlertSeverity(props.alert.severity)}`}
								size="small"
							/>
							<Chip label={formatAlertDomain(props.alert.domain)} size="small" variant="outlined" />
							{props.alert.incidentBackfill.required ? (
								<Chip
									color="warning"
									label={PANEL_COPY.overviewPage.alerts.incidentBackfill}
									size="small"
									variant="outlined"
								/>
							) : null}
						</Stack>
					</Stack>
					<Typography color="text.secondary" variant="body2">
						{PANEL_COPY.overviewPage.alerts.requestCount}: {formatCount(props.alert.requestCount)} ·{" "}
						{formatPanelTimestamp(props.alert.startedAt)}
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function OverviewDiagnosticsCard(props: {
	errorMessage: string | null;
	isPending: boolean;
	runtimeDiagnostics: PanelOverviewRecord | null;
}) {
	return (
		<OverviewChartCard
			description={PANEL_COPY.overviewPage.runtime.diagnosticsOnly}
			title={PANEL_COPY.overviewPage.runtime.title}
		>
			{props.isPending ? (
				<Stack spacing={1.5}>
					<Skeleton height={24} width="40%" />
					<Skeleton height={24} width="70%" />
					<Skeleton height={24} width="60%" />
				</Stack>
			) : null}

			{!props.isPending && props.errorMessage ? (
				<Alert severity="warning">{props.errorMessage}</Alert>
			) : null}

			{!(props.isPending || props.errorMessage) && props.runtimeDiagnostics ? (
				<Stack spacing={2}>
					<Box
						sx={{
							display: "grid",
							gap: 1,
							gridTemplateColumns: {
								md: "repeat(2, minmax(0, 1fr))",
								xs: "1fr",
							},
						}}
					>
						<Typography variant="body2">
							<strong>{PANEL_COPY.overviewPage.runtime.runtime}</strong>:{" "}
							{props.runtimeDiagnostics.runtime}
						</Typography>
						<Typography variant="body2">
							<strong>{PANEL_COPY.overviewPage.runtime.protectedHostname}</strong>:{" "}
							{props.runtimeDiagnostics.protectedHostname || PANEL_COPY.notSet}
						</Typography>
						<Typography variant="body2">
							<strong>{PANEL_COPY.overviewPage.runtime.protectionEnvelope}</strong>:{" "}
							{props.runtimeDiagnostics.protectionEnvelope}
						</Typography>
						<Typography variant="body2">
							<strong>{PANEL_COPY.overviewPage.runtime.apiBase}</strong>:{" "}
							{props.runtimeDiagnostics.runtimeApiBaseUrl || PANEL_COPY.workerServiceBinding}
						</Typography>
					</Box>

					{props.runtimeDiagnostics.operatorContext ? (
						<>
							<Divider />
							<Stack spacing={0.5}>
								<Typography sx={{ fontWeight: 600 }} variant="body2">
									{PANEL_COPY.overviewPage.runtime.operatorIdentity}
								</Typography>
								<Typography color="text.secondary" variant="body2">
									{props.runtimeDiagnostics.operatorContext.displayName ||
										props.runtimeDiagnostics.operatorContext.email ||
										props.runtimeDiagnostics.operatorContext.operatorId}{" "}
									· {formatPrincipalClass(props.runtimeDiagnostics.operatorContext.principalClass)}
								</Typography>
							</Stack>
						</>
					) : null}

					<Divider />
					<Stack spacing={1}>
						<Typography sx={{ fontWeight: 600 }} variant="body2">
							{PANEL_COPY.overviewPage.runtime.domainRollout}
						</Typography>
						<Box
							sx={{
								display: "grid",
								gap: 1,
								gridTemplateColumns: {
									md: "repeat(2, minmax(0, 1fr))",
									xs: "1fr",
								},
							}}
						>
							{Object.entries(props.runtimeDiagnostics.panelDomains).map(([domain, status]) => (
								<Stack
									direction="row"
									justifyContent="space-between"
									key={domain}
									spacing={2}
									sx={{ alignItems: "center" }}
								>
									<Typography variant="body2">
										{PANEL_COPY.overviewDomains[
											domain as keyof typeof PANEL_COPY.overviewDomains
										] ?? domain}
									</Typography>
									{renderDomainStatus(status)}
								</Stack>
							))}
						</Box>
					</Stack>
				</Stack>
			) : null}
		</OverviewChartCard>
	);
}

export function OverviewHeaderSection(props: {
	asOf: string | null;
	filters: OverviewFilterState;
	isRefreshing: boolean;
	onSelectedCapabilityChange(value: string): void;
	onSurfaceChange(value: string): void;
	onWindowChange(value: string): void;
}) {
	const filterSummaryItems = [
		`${PANEL_COPY.overviewPage.filterSummary.window}: ${formatOverviewWindowLabel(props.filters.window)}`,
		`${PANEL_COPY.overviewPage.filterSummary.surface}: ${
			props.filters.surface
				? formatSurfaceLabel(props.filters.surface)
				: PANEL_COPY.overviewPage.filters.allSurfaces
		}`,
		`${PANEL_COPY.overviewPage.filterSummary.selectedCapability}: ${
			props.filters.selectedCapability
				? formatSelectedCapabilityLabel(props.filters.selectedCapability)
				: PANEL_COPY.overviewPage.filters.allTargets
		}`,
	];

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
							{PANEL_COPY.overviewPage.title}
						</Typography>
						<Typography color="text.secondary" variant="body1">
							{PANEL_COPY.overviewPage.subtitle}
						</Typography>
					</Stack>

					<Stack
						direction={{ md: "row", xs: "column" }}
						spacing={1.5}
						sx={{ alignItems: { md: "center", xs: "stretch" } }}
					>
						<TextField
							label={PANEL_COPY.overviewPage.filters.window}
							name="window"
							onChange={(event) => props.onWindowChange(event.target.value)}
							select
							size="small"
							slotProps={PANEL_NATIVE_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 140, xs: "100%" } }}
							value={props.filters.window}
						>
							{OVERVIEW_WINDOW_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.overviewPage.filters.surface}
							name="surface"
							onChange={(event) => props.onSurfaceChange(event.target.value)}
							select
							size="small"
							slotProps={PANEL_NATIVE_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.surface ?? ""}
						>
							{SURFACE_OPTIONS.map((option) => (
								<option key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</option>
							))}
						</TextField>
						<TextField
							label={PANEL_COPY.overviewPage.filters.selectedCapability}
							name="selectedCapability"
							onChange={(event) => props.onSelectedCapabilityChange(event.target.value)}
							select
							size="small"
							slotProps={PANEL_NATIVE_SELECT_EMPTY_VALUE_SLOT_PROPS}
							sx={{ width: { md: 180, xs: "100%" } }}
							value={props.filters.selectedCapability ?? ""}
						>
							{TARGET_OPTIONS.map((option) => (
								<option key={option.value ?? "all"} value={option.value ?? ""}>
									{option.label}
								</option>
							))}
						</TextField>
						<Stack spacing={0.5} sx={{ minWidth: 0 }}>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.overviewPage.asOf}
							</Typography>
							<Typography sx={{ fontWeight: 600 }} variant="body2">
								{props.asOf ? formatPanelTimestamp(props.asOf) : PANEL_COPY.pending}
							</Typography>
						</Stack>
					</Stack>

					<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
						{filterSummaryItems.map((item) => (
							<Chip key={item} label={item} size="small" variant="outlined" />
						))}
						{props.isRefreshing ? (
							<Chip
								color="info"
								label={PANEL_COPY.overviewPage.refreshing}
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

export function OverviewLoadingGrid() {
	const skeletonCardKeys = [
		"overview-skeleton-1",
		"overview-skeleton-2",
		"overview-skeleton-3",
		"overview-skeleton-4",
		"overview-skeleton-5",
		"overview-skeleton-6",
	] as const;

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
			{skeletonCardKeys.map((key) => (
				<Card key={key} variant="outlined">
					<CardContent>
						<Stack spacing={1.25}>
							<Skeleton height={20} width="45%" />
							<Skeleton height={40} width="60%" />
							<Skeleton height={20} width="80%" />
						</Stack>
					</CardContent>
				</Card>
			))}
		</Box>
	);
}

export function OverviewPrimaryContent(props: {
	costSeries: Array<{
		bucketEnd: string;
		estimatedCostUsd: number;
		totalTokens: number;
	}>;
	overviewRecord: OperatorOverviewRecord;
	qualitySeries: Array<{
		bucketEnd: string;
		citationMissRatePct: number | null;
		emptyRecallRatePct: number | null;
		needsClarificationRatePct: number | null;
		noAnswerRatePct: number | null;
	}>;
	runtimeDiagnostics: PanelOverviewRecord | null;
	runtimeErrorMessage: string | null;
	runtimeIsPending: boolean;
}) {
	const kpiCards = buildOverviewCards(props.overviewRecord);

	return (
		<>
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
				{kpiCards.map((card) => (
					<OverviewMetricCard
						detail={card.detail}
						key={card.label}
						label={card.label}
						value={card.value}
					/>
				))}
			</Box>

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
				<OverviewChartCard
					description={PANEL_COPY.overviewPage.trends.qualitySummary}
					title={PANEL_COPY.overviewPage.trends.quality}
				>
					{props.qualitySeries.length > 0 ? (
						<PanelLineChart
							height={320}
							margin={{ bottom: 32, left: 40, right: 24, top: 24 }}
							series={[
								{
									data: props.qualitySeries.map((point) => point.emptyRecallRatePct),
									label: PANEL_COPY.overviewPage.qualitySeries.emptyRecallRate,
									showMark: false,
								},
								{
									data: props.qualitySeries.map((point) => point.citationMissRatePct),
									label: PANEL_COPY.overviewPage.qualitySeries.citationMissRate,
									showMark: false,
								},
								{
									data: props.qualitySeries.map((point) => point.needsClarificationRatePct),
									label: PANEL_COPY.overviewPage.qualitySeries.needsClarificationRate,
									showMark: false,
								},
								{
									data: props.qualitySeries.map((point) => point.noAnswerRatePct),
									label: PANEL_COPY.overviewPage.qualitySeries.noAnswerRate,
									showMark: false,
								},
							]}
							xAxis={[
								{
									data: props.qualitySeries.map((point) => formatTrendBucketLabel(point.bucketEnd)),
									scaleType: "point",
								},
							]}
						/>
					) : (
						<Alert severity="info">{PANEL_COPY.overviewPage.trends.empty}</Alert>
					)}
				</OverviewChartCard>

				<OverviewChartCard title={PANEL_COPY.overviewPage.trends.cost}>
					{props.costSeries.length > 0 ? (
						<Stack spacing={3}>
							<Stack spacing={1}>
								<Typography color="text.secondary" variant="body2">
									{PANEL_COPY.overviewPage.trends.costEstimate}
								</Typography>
								<PanelLineChart
									height={180}
									margin={{ bottom: 24, left: 56, right: 16, top: 12 }}
									series={[
										{
											data: props.costSeries.map((point) => point.estimatedCostUsd),
											label: PANEL_COPY.overviewPage.trends.costEstimate,
											showMark: false,
											valueFormatter: (value) =>
												value === null ? PANEL_COPY.unknown : `$${value.toFixed(4)}`,
										},
									]}
									xAxis={[
										{
											data: props.costSeries.map((point) =>
												formatTrendBucketLabel(point.bucketEnd),
											),
											scaleType: "point",
										},
									]}
								/>
							</Stack>

							<Divider />

							<Stack spacing={1}>
								<Typography color="text.secondary" variant="body2">
									{PANEL_COPY.overviewPage.trends.tokenUsage}
								</Typography>
								<PanelLineChart
									height={180}
									margin={{ bottom: 24, left: 56, right: 16, top: 12 }}
									series={[
										{
											data: props.costSeries.map((point) => point.totalTokens),
											label: PANEL_COPY.overviewPage.trends.tokenUsage,
											showMark: false,
											valueFormatter: (value) =>
												value === null ? PANEL_COPY.unknown : formatCount(value),
										},
									]}
									xAxis={[
										{
											data: props.costSeries.map((point) =>
												formatTrendBucketLabel(point.bucketEnd),
											),
											scaleType: "point",
										},
									]}
								/>
							</Stack>
						</Stack>
					) : (
						<Alert severity="info">{PANEL_COPY.overviewPage.trends.empty}</Alert>
					)}
				</OverviewChartCard>
			</Box>

			<Box
				sx={{
					display: "grid",
					gap: 2,
					gridTemplateColumns: {
						xl: "1.1fr 1fr",
						xs: "1fr",
					},
				}}
			>
				<OverviewChartCard title={PANEL_COPY.overviewPage.alerts.title}>
					{props.overviewRecord.alerts.length > 0 ? (
						<Stack spacing={1.5}>
							{props.overviewRecord.alerts.map((alert) => (
								<OverviewAlertCard alert={alert} key={alert.id} />
							))}
						</Stack>
					) : (
						<Alert severity="success">{PANEL_COPY.overviewPage.alerts.noAlerts}</Alert>
					)}
				</OverviewChartCard>

				<OverviewDiagnosticsCard
					errorMessage={props.runtimeErrorMessage}
					isPending={props.runtimeIsPending}
					runtimeDiagnostics={props.runtimeDiagnostics}
				/>
			</Box>
		</>
	);
}
