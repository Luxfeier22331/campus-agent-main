import { Alert, Box, Stack } from "@mui/material";
import { useQueries, useQuery } from "@tanstack/react-query";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY } from "../panel-copy";
import type { OperatorSafetyAnomalyRecord } from "../types";
import {
	buildSafetyDecisionCards,
	buildSafetyFilterSummaryItems,
	SafetyDecisionSection,
	SafetyDetailDrawer,
	SafetyHeaderSection,
	SafetyPostureSection,
	SafetyQueueSection,
} from "./safety-page/cards";
import type { SafetyFilterState } from "./safety-page/constants";
import { normalizeFilterValue, toQueryErrorMessage } from "./safety-page/formatters";

export function SafetyPage() {
	useAuthenticated();
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const [selectedAnomaly, setSelectedAnomaly] = useState<OperatorSafetyAnomalyRecord | null>(null);
	const anomalyPageLockRef = useRef(false);
	const [anomalyPageTransitionPending, setAnomalyPageTransitionPending] = useState(false);
	const [filters, setFilters] = useState<SafetyFilterState>({
		anomalyCode: "",
		page: 1,
		perPage: 10,
		selectedTarget: null,
		severity: "",
		status: "",
		surface: null,
		window: "24h",
	});

	const deferredWindow = useDeferredValue(filters.window);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedTarget = useDeferredValue(filters.selectedTarget);
	const deferredSeverity = useDeferredValue(filters.severity);
	const deferredStatus = useDeferredValue(filters.status);
	const deferredAnomalyCode = useDeferredValue(filters.anomalyCode);

	const isRefreshing =
		filters.window !== deferredWindow ||
		filters.surface !== deferredSurface ||
		filters.selectedTarget !== deferredSelectedTarget ||
		filters.severity !== deferredSeverity ||
		filters.status !== deferredStatus ||
		filters.anomalyCode !== deferredAnomalyCode;

	const [summaryQuery] = useQueries({
		queries: [
			{
				queryFn: ({ signal }) =>
					dataProvider.getOperatorSafetySummary({
						selectedTarget: deferredSelectedTarget,
						signal,
						surface: deferredSurface,
						window: deferredWindow,
					}),
				queryKey: [
					"protected-panel-safety-summary",
					deferredWindow,
					deferredSurface,
					deferredSelectedTarget,
				] as const,
				staleTime: 30_000,
			},
		] as const,
	});

	const anomaliesQuery = useQuery({
		queryFn: ({ signal }) =>
			dataProvider.listOperatorSafetyAnomalies({
				anomalyCode: normalizeFilterValue(deferredAnomalyCode),
				page: filters.page,
				perPage: filters.perPage,
				selectedTarget: deferredSelectedTarget,
				severity: normalizeFilterValue(deferredSeverity),
				signal,
				status: normalizeFilterValue(deferredStatus),
				surface: deferredSurface,
				window: deferredWindow,
			}),
		queryKey: [
			"protected-panel-safety-anomalies",
			filters.page,
			filters.perPage,
			deferredWindow,
			deferredSurface,
			deferredSelectedTarget,
			deferredSeverity,
			deferredStatus,
			deferredAnomalyCode,
		] as const,
		staleTime: 15_000,
	});

	const summaryErrorMessage = summaryQuery.error
		? toQueryErrorMessage(summaryQuery.error, PANEL_COPY.safetyPage.states.loadFailed)
		: null;
	const anomalyErrorMessage = anomaliesQuery.error
		? toQueryErrorMessage(anomaliesQuery.error, PANEL_COPY.safetyPage.states.anomalyLoadFailed)
		: null;

	useEffect(() => {
		if (!(anomaliesQuery.isPending || anomaliesQuery.isFetching)) {
			anomalyPageLockRef.current = false;
			setAnomalyPageTransitionPending(false);
		}
	}, [anomaliesQuery.isPending, anomaliesQuery.isFetching]);

	const summary = summaryQuery.data?.data ?? null;
	const anomalies = anomaliesQuery.data?.data ?? [];
	const anomalyPageInfo = anomaliesQuery.data?.pageInfo;
	const anomalyPageChanging =
		anomaliesQuery.isPending || anomaliesQuery.isFetching || anomalyPageTransitionPending;
	const decisionCards = buildSafetyDecisionCards(summary);
	const summaryFilterItems = useMemo(() => buildSafetyFilterSummaryItems(filters), [filters]);

	const queuePageDescription = useMemo(() => {
		const start = (filters.page - 1) * filters.perPage + 1;
		const end = start + anomalies.length - 1;
		if (anomalies.length === 0) {
			return `第 ${filters.page} 页`;
		}

		return `${start}-${end} · 第 ${filters.page} 页`;
	}, [anomalies.length, filters.page, filters.perPage]);

	return (
		<>
			<Title title={PANEL_COPY.menu.safety} />
			<Box sx={{ p: { md: 3, xs: 2 } }}>
				<Stack spacing={3}>
					<SafetyHeaderSection
						asOf={summary?.asOf ?? null}
						filterSummaryItems={summaryFilterItems}
						filters={filters}
						isRefreshing={isRefreshing}
						onSelectedTargetChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: 1,
									selectedTarget: normalizeFilterValue(value),
								}));
							});
						}}
						onSurfaceChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: 1,
									surface: normalizeFilterValue(value),
								}));
							});
						}}
						onWindowChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({ ...current, page: 1, window: value }));
							});
						}}
					/>

					{summaryErrorMessage ? <Alert severity="error">{summaryErrorMessage}</Alert> : null}

					<SafetyDecisionSection cards={decisionCards} />
					<SafetyPostureSection summary={summary} />

					<SafetyQueueSection
						anomalyErrorMessage={anomalyErrorMessage}
						anomalies={anomalies}
						hasNextPage={Boolean(anomalyPageInfo?.hasNextPage)}
						isPageChanging={anomalyPageChanging}
						isPending={anomaliesQuery.isPending}
						onAnomalyCodeChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									anomalyCode: value,
									page: 1,
								}));
							});
						}}
						onNextPage={() => {
							if (
								anomalyPageLockRef.current ||
								anomalyPageChanging ||
								!anomalyPageInfo?.hasNextPage
							) {
								return;
							}
							anomalyPageLockRef.current = true;
							setAnomalyPageTransitionPending(true);
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
							if (anomalyPageLockRef.current || anomalyPageChanging || filters.page <= 1) {
								return;
							}
							anomalyPageLockRef.current = true;
							setAnomalyPageTransitionPending(true);
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: Math.max(1, current.page - 1),
								}));
							});
						}}
						onSelectAnomaly={setSelectedAnomaly}
						onSeverityChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: 1,
									severity: value,
								}));
							});
						}}
						onStatusChange={(value) => {
							startTransition(() => {
								setFilters((current) => ({
									...current,
									page: 1,
									status: value,
								}));
							});
						}}
						pageDescription={queuePageDescription}
						queueFilters={filters}
					/>
				</Stack>
			</Box>

			<SafetyDetailDrawer
				onClose={() => setSelectedAnomaly(null)}
				selectedAnomaly={selectedAnomaly}
			/>
		</>
	);
}
