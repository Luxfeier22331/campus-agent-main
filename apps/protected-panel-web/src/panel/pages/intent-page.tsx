import {
	Alert,
	Box,
	Card,
	CardContent,
	Chip,
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
import { LineChart } from "@mui/x-charts/LineChart";
import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { startTransition, useDeferredValue, useMemo, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { formatPanelTimestamp, PANEL_COPY } from "../panel-copy";
import {
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatSelectedTargetLabel,
	formatSurfaceLabel,
} from "../requests/request-formatters";
import type {
	OperatorDistributionBucket,
	OperatorIntentSummaryRecord,
	OperatorIntentTimeseriesRecord,
	OperatorOverviewWindow,
} from "../types";
import { resolveOverviewGranularity } from "./overview-domain";
import {
	formatMetricEvidence,
	formatMetricRate,
	formatOverviewWindowLabel,
	formatTrendBucketLabel,
	normalizeFilterValue,
	toQueryErrorMessage,
} from "./overview-page/formatters";

interface IntentFilterState {
	selectedTarget: string | null;
	surface: string | null;
	window: OperatorOverviewWindow;
}

const WINDOW_OPTIONS: Array<{ label: string; value: OperatorOverviewWindow }> = [
	{ label: "15 分钟", value: "15m" },
	{ label: "1 小时", value: "1h" },
	{ label: "24 小时", value: "24h" },
	{ label: "7 天", value: "7d" },
	{ label: "30 天", value: "30d" },
];

const SURFACE_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allSurfaces, value: null },
	{ label: formatSurfaceLabel("public_chat_web"), value: "public_chat_web" },
	{ label: formatSurfaceLabel("protected_panel_web"), value: "protected_panel_web" },
];

const TARGET_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allTargets, value: null },
	...CURRENT_RUNTIME_TARGET_OPTIONS,
];

function formatCount(value: number) {
	return new Intl.NumberFormat("zh-CN").format(value);
}

function SummaryCard(props: { detail: string; label: string; value: string }) {
	return (
		<Card sx={{ backgroundColor: "background.paper", borderRadius: 2 }} variant="outlined">
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

function SectionCard(props: { children: ReactNode; title: string }) {
	return (
		<Card sx={{ backgroundColor: "background.paper", borderRadius: 2 }} variant="outlined">
			<CardContent>
				<Stack spacing={2}>
					<Typography sx={{ fontWeight: 700 }} variant="h6">
						{props.title}
					</Typography>
					{props.children}
				</Stack>
			</CardContent>
		</Card>
	);
}

function buildSummaryCards(summary: OperatorIntentSummaryRecord) {
	const sampledIntentPassRate = summary.sampledGrades?.intentPassRate ?? null;
	return [
		{
			detail: `${PANEL_COPY.intentPage.currentFilters}: ${formatMetricEvidence({
				count: summary.runtime.requestCount,
				eligibleCount: null,
				value: 0,
			})}`,
			label: PANEL_COPY.intentPage.cards.requestCount,
			value: formatCount(summary.runtime.requestCount),
		},
		{
			detail: formatMetricEvidence(summary.runtime.lowConfidenceRate),
			label: PANEL_COPY.intentPage.cards.lowConfidenceRate,
			value: formatMetricRate(summary.runtime.lowConfidenceRate),
		},
		{
			detail: formatMetricEvidence(summary.runtime.ambiguityRate),
			label: PANEL_COPY.intentPage.cards.ambiguityRate,
			value: formatMetricRate(summary.runtime.ambiguityRate),
		},
		{
			detail: formatMetricEvidence(summary.runtime.contextUnresolvedRate),
			label: PANEL_COPY.intentPage.cards.contextUnresolvedRate,
			value: formatMetricRate(summary.runtime.contextUnresolvedRate),
		},
		{
			detail: sampledIntentPassRate
				? formatMetricEvidence(sampledIntentPassRate)
				: PANEL_COPY.notAvailable,
			label: PANEL_COPY.intentPage.cards.intentPassRate,
			value: sampledIntentPassRate ? formatMetricRate(sampledIntentPassRate) : PANEL_COPY.unknown,
		},
	];
}

function DistributionSection(props: { buckets: OperatorDistributionBucket[]; title: string }) {
	return (
		<SectionCard title={props.title}>
			{props.buckets.length > 0 ? (
				<Box sx={{ overflowX: "auto" }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>{props.title}</TableCell>
								<TableCell>请求数</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{props.buckets.map((bucket) => (
								<TableRow key={bucket.value}>
									<TableCell>
										<Chip label={bucket.value} size="small" variant="outlined" />
									</TableCell>
									<TableCell>{formatCount(bucket.count)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Box>
			) : (
				<Alert severity="info">{PANEL_COPY.intentPage.distributions.empty}</Alert>
			)}
		</SectionCard>
	);
}

function toPercent(value: number | null) {
	return value === null ? null : Number((value * 100).toFixed(2));
}

function buildTrendSeries(series: OperatorIntentTimeseriesRecord["series"]) {
	return series.map((bucket) => ({
		ambiguityRate: toPercent(bucket.ambiguityRate),
		bucket: bucket.bucketStart,
		contextUnresolvedRate: toPercent(bucket.contextUnresolvedRate),
		lowConfidenceRate: toPercent(bucket.lowConfidenceRate),
		sampledIntentPassRate: toPercent(bucket.sampledIntentPassRate),
	}));
}

export function IntentPage() {
	useAuthenticated();
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const [filters, setFilters] = useState<IntentFilterState>({
		selectedTarget: null,
		surface: null,
		window: "24h",
	});

	const deferredWindow = useDeferredValue(filters.window);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedTarget = useDeferredValue(filters.selectedTarget);
	const isRefreshing =
		filters.window !== deferredWindow ||
		filters.surface !== deferredSurface ||
		filters.selectedTarget !== deferredSelectedTarget;

	const [summaryQuery, timeseriesQuery] = useQueries({
		queries: [
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorIntentSummary({
						selectedTarget: deferredSelectedTarget,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-intent-summary",
					deferredWindow,
					deferredSurface,
					deferredSelectedTarget,
				] as const,
				staleTime: 30_000,
			},
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorIntentTimeseries({
						granularity: resolveOverviewGranularity(deferredWindow),
						selectedTarget: deferredSelectedTarget,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-intent-timeseries",
					deferredWindow,
					resolveOverviewGranularity(deferredWindow),
					deferredSurface,
					deferredSelectedTarget,
				] as const,
				staleTime: 30_000,
			},
		] as const,
	});

	const errorMessage = summaryQuery.error
		? toQueryErrorMessage(summaryQuery.error, PANEL_COPY.intentPage.states.loadFailed)
		: timeseriesQuery.error
			? toQueryErrorMessage(timeseriesQuery.error, PANEL_COPY.intentPage.states.loadFailed)
			: null;
	const summary = summaryQuery.data?.data ?? null;
	const timeseries = timeseriesQuery.data?.data ?? null;
	const trendSeries = timeseries ? buildTrendSeries(timeseries.series) : [];
	const summaryCards = summary ? buildSummaryCards(summary) : [];
	const asOf = summary?.asOf ?? timeseries?.asOf ?? null;
	const filterSummaryItems = useMemo(
		() => [
			`${PANEL_COPY.overviewPage.filterSummary.window}: ${formatOverviewWindowLabel(filters.window)}`,
			`${PANEL_COPY.overviewPage.filterSummary.surface}: ${
				filters.surface
					? formatSurfaceLabel(filters.surface)
					: PANEL_COPY.overviewPage.filters.allSurfaces
			}`,
			`${PANEL_COPY.overviewPage.filterSummary.selectedTarget}: ${
				filters.selectedTarget
					? formatSelectedTargetLabel(filters.selectedTarget)
					: PANEL_COPY.overviewPage.filters.allTargets
			}`,
		],
		[filters.selectedTarget, filters.surface, filters.window],
	);

	return (
		<>
			<Title title={PANEL_COPY.menu.intent} />
			<Box sx={{ p: { md: 3, xs: 2 } }}>
				<Stack spacing={3}>
					<Card sx={{ backgroundColor: "background.paper", borderRadius: 2 }} variant="outlined">
						<CardContent sx={{ p: { md: 2.5, xs: 2 }, "&:last-child": { pb: { md: 2.5, xs: 2 } } }}>
							<Stack spacing={2}>
								<Stack spacing={1}>
									<Typography sx={{ fontWeight: 700 }} variant="h5">
										{PANEL_COPY.intentPage.title}
									</Typography>
									<Typography color="text.secondary" variant="body1">
										{PANEL_COPY.intentPage.subtitle}
									</Typography>
								</Stack>
								<Stack
									direction={{ md: "row", xs: "column" }}
									spacing={1.5}
									sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
								>
									<TextField
										label={PANEL_COPY.overviewPage.filters.window}
										onChange={(event) => {
											const nextWindow = event.target.value as OperatorOverviewWindow;
											startTransition(() => {
												setFilters((current) => ({ ...current, window: nextWindow }));
											});
										}}
										select
										size="small"
										sx={{ width: { md: 140, xs: "100%" } }}
										value={filters.window}
									>
										{WINDOW_OPTIONS.map((option) => (
											<MenuItem key={option.value} value={option.value}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
									<TextField
										label={PANEL_COPY.overviewPage.filters.surface}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													surface: normalizeFilterValue(event.target.value),
												}));
											});
										}}
										select
										size="small"
										sx={{ width: { md: 180, xs: "100%" } }}
										value={filters.surface ?? ""}
									>
										{SURFACE_OPTIONS.map((option) => (
											<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
									<TextField
										label={PANEL_COPY.overviewPage.filters.selectedTarget}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													selectedTarget: normalizeFilterValue(event.target.value),
												}));
											});
										}}
										select
										size="small"
										sx={{ width: { md: 220, xs: "100%" } }}
										value={filters.selectedTarget ?? ""}
									>
										{TARGET_OPTIONS.map((option) => (
											<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
								</Stack>
								<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
									{filterSummaryItems.map((item) => (
										<Chip key={item} label={item} size="small" variant="outlined" />
									))}
									{asOf ? (
										<Chip
											label={`${PANEL_COPY.intentPage.asOf}: ${formatPanelTimestamp(asOf)}`}
											size="small"
										/>
									) : null}
									{isRefreshing ? (
										<Chip color="warning" label={PANEL_COPY.intentPage.refreshing} size="small" />
									) : null}
								</Stack>
							</Stack>
						</CardContent>
					</Card>

					{summaryQuery.isPending || timeseriesQuery.isPending ? (
						<Alert severity="info">{PANEL_COPY.intentPage.states.loading}</Alert>
					) : null}

					{errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

					{summary ? (
						<Box
							sx={{
								display: "grid",
								gap: 2,
								gridTemplateColumns: {
									lg: "repeat(5, minmax(0, 1fr))",
									md: "repeat(2, minmax(0, 1fr))",
									xs: "1fr",
								},
							}}
						>
							{summaryCards.map((card) => (
								<SummaryCard
									detail={card.detail}
									key={card.label}
									label={card.label}
									value={card.value}
								/>
							))}
						</Box>
					) : null}

					{timeseries ? (
						<SectionCard title={PANEL_COPY.intentPage.trends.title}>
							{trendSeries.length > 0 ? (
								<LineChart
									dataset={trendSeries}
									height={320}
									margin={{ bottom: 42, left: 48, right: 24, top: 20 }}
									series={[
										{
											dataKey: "lowConfidenceRate",
											label: PANEL_COPY.intentPage.trends.lowConfidenceRate,
										},
										{
											dataKey: "ambiguityRate",
											label: PANEL_COPY.intentPage.trends.ambiguityRate,
										},
										{
											dataKey: "contextUnresolvedRate",
											label: PANEL_COPY.intentPage.trends.contextUnresolvedRate,
										},
										{
											dataKey: "sampledIntentPassRate",
											label: PANEL_COPY.intentPage.trends.sampledIntentPassRate,
										},
									]}
									xAxis={[
										{
											dataKey: "bucket",
											scaleType: "point",
											valueFormatter: formatTrendBucketLabel,
										},
									]}
								/>
							) : (
								<Alert severity="info">{PANEL_COPY.intentPage.trends.empty}</Alert>
							)}
						</SectionCard>
					) : null}

					{summary ? (
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
							<DistributionSection
								buckets={summary.runtime.distributions.capability}
								title={PANEL_COPY.intentPage.distributions.capability}
							/>
							<DistributionSection
								buckets={summary.runtime.distributions.taskKind}
								title={PANEL_COPY.intentPage.distributions.taskKind}
							/>
							<DistributionSection
								buckets={summary.runtime.distributions.nextAction}
								title={PANEL_COPY.intentPage.distributions.nextAction}
							/>
							<DistributionSection
								buckets={summary.runtime.distributions.classifierVersion}
								title={PANEL_COPY.intentPage.distributions.classifierVersion}
							/>
							<DistributionSection
								buckets={summary.runtime.distributions.schemaVersion}
								title={PANEL_COPY.intentPage.distributions.schemaVersion}
							/>
						</Box>
					) : null}
				</Stack>
			</Box>
		</>
	);
}
