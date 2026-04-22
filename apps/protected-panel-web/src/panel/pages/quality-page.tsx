import { Alert, Box, Stack } from "@mui/material";
import { useQueries, useQuery } from "@tanstack/react-query";
import { startTransition, useDeferredValue, useMemo, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY } from "../panel-copy";
import type { OperatorQualityBadcaseRecord } from "../types";
import { resolveOverviewGranularity } from "./overview-domain";
import { buildQualityRuntimeTrendSeries, buildRefusalDistributionEntries } from "./quality-domain";
import {
	buildQualityFilterSummaryItems,
	QualityDetailDrawer,
	QualityHeaderSection,
	QualityInsightSections,
	QualityQueueSection,
	QualitySummaryGrid,
} from "./quality-page/cards";
import type { QualityFilterState } from "./quality-page/constants";
import {
	buildRuntimeSummaryCards,
	buildSampledCards,
	normalizeFilterValue,
	toQueryErrorMessage,
} from "./quality-page/formatters";

export function QualityPage() {
	useAuthenticated();
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const [selectedBadcase, setSelectedBadcase] = useState<OperatorQualityBadcaseRecord | null>(null);
	const [filters, setFilters] = useState<QualityFilterState>({
		badcaseCauseClass: "",
		badcaseDetectedBy: "",
		badcaseStatus: "",
		page: 1,
		perPage: 10,
		selectedTarget: null,
		surface: null,
		window: "24h",
	});

	const deferredWindow = useDeferredValue(filters.window);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedTarget = useDeferredValue(filters.selectedTarget);
	const deferredBadcaseStatus = useDeferredValue(filters.badcaseStatus);
	const deferredBadcaseCauseClass = useDeferredValue(filters.badcaseCauseClass);
	const deferredBadcaseDetectedBy = useDeferredValue(filters.badcaseDetectedBy);

	const isRefreshing =
		filters.window !== deferredWindow ||
		filters.surface !== deferredSurface ||
		filters.selectedTarget !== deferredSelectedTarget ||
		filters.badcaseStatus !== deferredBadcaseStatus ||
		filters.badcaseCauseClass !== deferredBadcaseCauseClass ||
		filters.badcaseDetectedBy !== deferredBadcaseDetectedBy;

	const [summaryQuery, timeseriesQuery] = useQueries({
		queries: [
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorQualitySummary({
						selectedTarget: deferredSelectedTarget,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-quality-summary",
					deferredWindow,
					deferredSurface,
					deferredSelectedTarget,
				] as const,
				staleTime: 30_000,
			},
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorQualityTimeseries({
						granularity: resolveOverviewGranularity(deferredWindow),
						selectedTarget: deferredSelectedTarget,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-quality-timeseries-page",
					deferredWindow,
					resolveOverviewGranularity(deferredWindow),
					deferredSurface,
					deferredSelectedTarget,
				] as const,
				staleTime: 30_000,
			},
		] as const,
	});

	const badcasesQuery = useQuery({
		queryFn: ({ signal }) =>
			dataProvider.listOperatorQualityBadcases({
				causeClass: normalizeFilterValue(deferredBadcaseCauseClass),
				detectedBy: normalizeFilterValue(deferredBadcaseDetectedBy),
				page: filters.page,
				perPage: filters.perPage,
				signal,
				status: normalizeFilterValue(deferredBadcaseStatus),
			}),
		queryKey: [
			"protected-panel-quality-badcases",
			filters.page,
			filters.perPage,
			deferredBadcaseStatus,
			deferredBadcaseCauseClass,
			deferredBadcaseDetectedBy,
		] as const,
		staleTime: 15_000,
	});

	const summaryErrorMessage = summaryQuery.error
		? toQueryErrorMessage(summaryQuery.error, PANEL_COPY.qualityPage.states.loadFailed)
		: null;
	const timeseriesErrorMessage = timeseriesQuery.error
		? toQueryErrorMessage(timeseriesQuery.error, PANEL_COPY.qualityPage.states.loadFailed)
		: null;
	const badcaseErrorMessage = badcasesQuery.error
		? toQueryErrorMessage(badcasesQuery.error, PANEL_COPY.qualityPage.states.badcaseLoadFailed)
		: null;

	const summary = summaryQuery.data?.data ?? null;
	const timeseries = timeseriesQuery.data?.data ?? null;
	const badcases = badcasesQuery.data?.data ?? [];
	const badcasePageInfo = badcasesQuery.data?.pageInfo;
	const trendSeries = timeseries ? buildQualityRuntimeTrendSeries(timeseries.series) : [];
	const runtimeSummaryCards = summary ? buildRuntimeSummaryCards(summary) : [];
	const sampledCards = summary ? buildSampledCards(summary) : [];
	const refusalEntries = summary
		? buildRefusalDistributionEntries(summary.runtime.refusalDistribution)
		: [];
	const filterSummaryItems = useMemo(() => buildQualityFilterSummaryItems(filters), [filters]);

	const queuePageDescription = useMemo(() => {
		const start = (filters.page - 1) * filters.perPage + 1;
		const end = start + badcases.length - 1;
		if (badcases.length === 0) {
			return `第 ${filters.page} 页`;
		}

		return `${start}-${end} · 第 ${filters.page} 页`;
	}, [badcases.length, filters.page, filters.perPage]);

	const asOf = summary?.asOf ?? timeseries?.asOf ?? null;

	return (
		<>
			<Title title={PANEL_COPY.menu.quality} />
			<Box sx={{ p: { md: 3, xs: 2 } }}>
				<Stack spacing={3}>
					<QualityHeaderSection
						asOf={asOf}
						filterSummaryItems={filterSummaryItems}
						filters={filters}
						isRefreshing={isRefreshing}
						onSelectedTargetChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									selectedTarget: normalizeFilterValue(value),
								}));
							});
						}}
						onSurfaceChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									surface: normalizeFilterValue(value),
								}));
							});
						}}
						onWindowChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({ ...current, window: value }));
							});
						}}
					/>

					{summaryErrorMessage ? <Alert severity="error">{summaryErrorMessage}</Alert> : null}

					<QualitySummaryGrid cards={runtimeSummaryCards} />

					<QualityInsightSections
						refusalEntries={refusalEntries}
						sampledCards={sampledCards}
						summaryHasSampledGrades={Boolean(summary?.sampledGrades)}
						timeseriesErrorMessage={timeseriesErrorMessage}
						trendSeries={trendSeries}
					/>

					<QualityQueueSection
						badcaseErrorMessage={badcaseErrorMessage}
						badcases={badcases}
						hasNextPage={Boolean(badcasePageInfo?.hasNextPage)}
						isPending={badcasesQuery.isPending}
						onCauseClassChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									badcaseCauseClass: value,
									page: 1,
								}));
							});
						}}
						onDetectedByChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									badcaseDetectedBy: value,
									page: 1,
								}));
							});
						}}
						onNextPage={() => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: current.page + 1,
								}));
							});
						}}
						onPerPageChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: 1,
									perPage: value,
								}));
							});
						}}
						onPreviousPage={() => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: Math.max(1, current.page - 1),
								}));
							});
						}}
						onSelectBadcase={setSelectedBadcase}
						onStatusChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									badcaseStatus: value,
									page: 1,
								}));
							});
						}}
						pageDescription={queuePageDescription}
						queueFilters={filters}
					/>
				</Stack>
			</Box>

			<QualityDetailDrawer
				onClose={() => setSelectedBadcase(null)}
				selectedBadcase={selectedBadcase}
			/>
		</>
	);
}
