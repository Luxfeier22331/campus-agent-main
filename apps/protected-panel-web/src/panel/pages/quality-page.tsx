import { Alert, Stack } from "@mui/material";
import { useQueries, useQuery } from "@tanstack/react-query";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";
import { useSearchParams } from "react-router-dom";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OperatorQualityBadcaseRecord } from "../types";
import { resolveOverviewGranularity } from "./overview-domain";
import { buildQualityRuntimeTrendSeries, buildRefusalDistributionEntries } from "./quality-domain";
import {
	buildQualityFilterSummaryItems,
	QualityDetailDrawer,
	QualityEvalCandidateSection,
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
	const [searchParams] = useSearchParams();
	const [selectedBadcase, setSelectedBadcase] = useState<OperatorQualityBadcaseRecord | null>(null);
	const badcasePageLockRef = useRef(false);
	const evalCandidatePageLockRef = useRef(false);
	const [badcasePageTransitionPending, setBadcasePageTransitionPending] = useState(false);
	const [evalCandidatePageTransitionPending, setEvalCandidatePageTransitionPending] =
		useState(false);
	const [filters, setFilters] = useState<QualityFilterState>({
		badcaseCauseClass: searchParams.get("causeClass") ?? "",
		badcaseDetectedBy: searchParams.get("detectedBy") ?? "",
		badcaseStatus: searchParams.get("status") ?? "",
		evalPage: 1,
		page: 1,
		perPage: 10,
		selectedCapability: null,
		surface: searchParams.get("surface"),
		window: (searchParams.get("window") as QualityFilterState["window"] | null) ?? "24h",
	});

	const deferredWindow = useDeferredValue(filters.window);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedCapability = useDeferredValue(filters.selectedCapability);
	const deferredBadcaseStatus = useDeferredValue(filters.badcaseStatus);
	const deferredBadcaseCauseClass = useDeferredValue(filters.badcaseCauseClass);
	const deferredBadcaseDetectedBy = useDeferredValue(filters.badcaseDetectedBy);

	const isRefreshing =
		filters.window !== deferredWindow ||
		filters.surface !== deferredSurface ||
		filters.selectedCapability !== deferredSelectedCapability ||
		filters.badcaseStatus !== deferredBadcaseStatus ||
		filters.badcaseCauseClass !== deferredBadcaseCauseClass ||
		filters.badcaseDetectedBy !== deferredBadcaseDetectedBy;

	const [summaryQuery, timeseriesQuery] = useQueries({
		queries: [
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorQualitySummary({
						selectedCapability: deferredSelectedCapability,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-quality-summary",
					deferredWindow,
					deferredSurface,
					deferredSelectedCapability,
				] as const,
				staleTime: 30_000,
			},
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorQualityTimeseries({
						granularity: resolveOverviewGranularity(deferredWindow),
						selectedCapability: deferredSelectedCapability,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-quality-timeseries-page",
					deferredWindow,
					resolveOverviewGranularity(deferredWindow),
					deferredSurface,
					deferredSelectedCapability,
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
				selectedCapability: deferredSelectedCapability,
				signal,
				status: normalizeFilterValue(deferredBadcaseStatus),
				surface: deferredSurface,
				window: deferredWindow,
			}),
		queryKey: [
			"protected-panel-quality-badcases",
			filters.page,
			filters.perPage,
			deferredWindow,
			deferredSurface,
			deferredSelectedCapability,
			deferredBadcaseStatus,
			deferredBadcaseCauseClass,
			deferredBadcaseDetectedBy,
		] as const,
		staleTime: 15_000,
	});

	const evalCandidatesQuery = useQuery({
		queryFn: ({ signal }) =>
			dataProvider.listOperatorQualityEvalCandidates({
				causeClass: normalizeFilterValue(deferredBadcaseCauseClass),
				detectedBy: normalizeFilterValue(deferredBadcaseDetectedBy),
				page: filters.evalPage,
				perPage: filters.perPage,
				selectedCapability: deferredSelectedCapability,
				signal,
				status: normalizeFilterValue(deferredBadcaseStatus),
				surface: deferredSurface,
				window: deferredWindow,
			}),
		queryKey: [
			"protected-panel-quality-eval-candidates",
			filters.evalPage,
			filters.perPage,
			deferredWindow,
			deferredSurface,
			deferredSelectedCapability,
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
	const evalCandidatesErrorMessage = evalCandidatesQuery.error
		? toQueryErrorMessage(
				evalCandidatesQuery.error,
				PANEL_COPY.qualityPage.states.badcaseLoadFailed,
			)
		: null;

	useEffect(() => {
		if (!(badcasesQuery.isPending || badcasesQuery.isFetching)) {
			badcasePageLockRef.current = false;
			setBadcasePageTransitionPending(false);
		}
	}, [badcasesQuery.isPending, badcasesQuery.isFetching]);

	useEffect(() => {
		if (!(evalCandidatesQuery.isPending || evalCandidatesQuery.isFetching)) {
			evalCandidatePageLockRef.current = false;
			setEvalCandidatePageTransitionPending(false);
		}
	}, [evalCandidatesQuery.isPending, evalCandidatesQuery.isFetching]);

	const summary = summaryQuery.data?.data ?? null;
	const timeseries = timeseriesQuery.data?.data ?? null;
	const badcases = badcasesQuery.data?.data ?? [];
	const badcasePageInfo = badcasesQuery.data?.pageInfo;
	const evalCandidates = evalCandidatesQuery.data?.data ?? [];
	const evalCandidatePageInfo = evalCandidatesQuery.data?.pageInfo;
	const badcasePageChanging =
		badcasesQuery.isPending || badcasesQuery.isFetching || badcasePageTransitionPending;
	const evalCandidatePageChanging =
		evalCandidatesQuery.isPending ||
		evalCandidatesQuery.isFetching ||
		evalCandidatePageTransitionPending;
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
	const evalCandidatePageDescription = useMemo(() => {
		const start = (filters.evalPage - 1) * filters.perPage + 1;
		const end = start + evalCandidates.length - 1;
		if (evalCandidates.length === 0) {
			return `第 ${filters.evalPage} 页`;
		}

		return `${start}-${end} · 第 ${filters.evalPage} 页`;
	}, [evalCandidates.length, filters.evalPage, filters.perPage]);

	const asOf = summary?.asOf ?? timeseries?.asOf ?? null;

	return (
		<>
			<Title title={PANEL_COPY.menu.quality} />
			<PanelPage>
				<Stack spacing={3}>
					<QualityHeaderSection
						asOf={asOf}
						filterSummaryItems={filterSummaryItems}
						filters={filters}
						isRefreshing={isRefreshing}
						onSelectedCapabilityChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									evalPage: 1,
									page: 1,
									selectedCapability: normalizeFilterValue(value),
								}));
							});
						}}
						onSurfaceChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									evalPage: 1,
									page: 1,
									surface: normalizeFilterValue(value),
								}));
							});
						}}
						onWindowChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({ ...current, evalPage: 1, page: 1, window: value }));
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
						isPageChanging={badcasePageChanging}
						isPending={badcasesQuery.isPending}
						onCauseClassChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									badcaseCauseClass: value,
									evalPage: 1,
									page: 1,
								}));
							});
						}}
						onDetectedByChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									badcaseDetectedBy: value,
									evalPage: 1,
									page: 1,
								}));
							});
						}}
						onNextPage={() => {
							if (
								badcasePageLockRef.current ||
								badcasePageChanging ||
								!badcasePageInfo?.hasNextPage
							) {
								return;
							}
							badcasePageLockRef.current = true;
							setBadcasePageTransitionPending(true);
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
									evalPage: 1,
									perPage: value,
								}));
							});
						}}
						onPreviousPage={() => {
							if (badcasePageLockRef.current || badcasePageChanging || filters.page <= 1) {
								return;
							}
							badcasePageLockRef.current = true;
							setBadcasePageTransitionPending(true);
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
									evalPage: 1,
									page: 1,
								}));
							});
						}}
						pageDescription={queuePageDescription}
						queueFilters={filters}
					/>

					<QualityEvalCandidateSection
						candidates={evalCandidates}
						errorMessage={evalCandidatesErrorMessage}
						hasNextPage={Boolean(evalCandidatePageInfo?.hasNextPage)}
						isPageChanging={evalCandidatePageChanging}
						isPending={evalCandidatesQuery.isPending}
						onNextPage={() => {
							if (
								evalCandidatePageLockRef.current ||
								evalCandidatePageChanging ||
								!evalCandidatePageInfo?.hasNextPage
							) {
								return;
							}
							evalCandidatePageLockRef.current = true;
							setEvalCandidatePageTransitionPending(true);
							startTransition(() => {
								setFilters((current) => ({
									...current,
									evalPage: current.evalPage + 1,
								}));
							});
						}}
						onPreviousPage={() => {
							if (
								evalCandidatePageLockRef.current ||
								evalCandidatePageChanging ||
								filters.evalPage <= 1
							) {
								return;
							}
							evalCandidatePageLockRef.current = true;
							setEvalCandidatePageTransitionPending(true);
							startTransition(() => {
								setFilters((current) => ({
									...current,
									evalPage: Math.max(1, current.evalPage - 1),
								}));
							});
						}}
						pageDescription={evalCandidatePageDescription}
						queueFilters={filters}
					/>
				</Stack>
			</PanelPage>

			<QualityDetailDrawer
				onClose={() => setSelectedBadcase(null)}
				selectedBadcase={selectedBadcase}
			/>
		</>
	);
}
