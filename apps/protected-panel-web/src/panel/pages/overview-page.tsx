import { Alert, Stack } from "@mui/material";
import { useQueries } from "@tanstack/react-query";
import { startTransition, useDeferredValue, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY } from "../panel-copy";
import { PanelPage } from "../panel-page";
import type { OperatorOverviewWindow } from "../types";
import { buildCostTrendSeries } from "./cost-domain";
import { buildQualityTrendSeries, resolveOverviewGranularity } from "./overview-domain";
import {
	OverviewHeaderSection,
	OverviewLoadingGrid,
	OverviewPrimaryContent,
} from "./overview-page/cards";
import type { OverviewFilterState } from "./overview-page/constants";
import { normalizeFilterValue, toQueryErrorMessage } from "./overview-page/formatters";

export function OverviewPage() {
	useAuthenticated();
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const [filters, setFilters] = useState<OverviewFilterState>({
		selectedCapability: null,
		surface: null,
		window: "24h",
	});

	const deferredWindow = useDeferredValue(filters.window);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedCapability = useDeferredValue(filters.selectedCapability);

	const isRefreshing =
		filters.window !== deferredWindow ||
		filters.surface !== deferredSurface ||
		filters.selectedCapability !== deferredSelectedCapability;

	const [overviewQuery, qualityTimeseriesQuery, costTimeseriesQuery, runtimeDiagnosticsQuery] =
		useQueries({
			queries: [
				{
					queryFn: ({ signal }) =>
						dataProvider.getOperatorOverview({
							selectedCapability: deferredSelectedCapability,
							signal,
							surface: deferredSurface,
							window: deferredWindow,
						}),
					queryKey: [
						"protected-panel-overview",
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
						"protected-panel-quality-timeseries",
						deferredWindow,
						resolveOverviewGranularity(deferredWindow),
						deferredSurface,
						deferredSelectedCapability,
					] as const,
					staleTime: 30_000,
				},
				{
					queryFn: ({ signal }) =>
						dataProvider.getOperatorCostTimeseries({
							granularity: resolveOverviewGranularity(deferredWindow),
							selectedCapability: deferredSelectedCapability,
							signal,
							surface: deferredSurface,
							window: deferredWindow,
						}),
					queryKey: [
						"protected-panel-cost-timeseries",
						deferredWindow,
						resolveOverviewGranularity(deferredWindow),
						deferredSurface,
						deferredSelectedCapability,
					] as const,
					staleTime: 30_000,
				},
				{
					queryFn: ({ signal }) => dataProvider.getOverview({ signal }),
					queryKey: ["protected-panel-runtime-diagnostics"] as const,
					staleTime: 60_000,
				},
			] as const,
		});

	const primaryQueries = [overviewQuery, qualityTimeseriesQuery, costTimeseriesQuery];
	const primaryError = primaryQueries.find((query) => query.error)?.error;
	const primaryErrorMessage = primaryError
		? toQueryErrorMessage(primaryError, PANEL_COPY.overviewPage.states.loadFailed)
		: null;
	const runtimeErrorMessage = runtimeDiagnosticsQuery.error
		? toQueryErrorMessage(
				runtimeDiagnosticsQuery.error,
				PANEL_COPY.overviewPage.states.runtimeLoadFailed,
			)
		: null;

	const isPending = primaryQueries.some((query) => query.isPending);
	const overviewRecord = overviewQuery.data?.data ?? null;
	const qualityTimeseries = qualityTimeseriesQuery.data?.data ?? null;
	const costTimeseries = costTimeseriesQuery.data?.data ?? null;
	const runtimeDiagnostics = runtimeDiagnosticsQuery.data?.data ?? null;

	const qualitySeries = qualityTimeseries ? buildQualityTrendSeries(qualityTimeseries.series) : [];
	const costSeries = costTimeseries ? buildCostTrendSeries(costTimeseries.series) : [];
	const asOf = overviewRecord?.asOf ?? qualityTimeseries?.asOf ?? costTimeseries?.asOf ?? null;
	const handleWindowChange = (value: string) => {
		const nextWindow = value as OperatorOverviewWindow;
		startTransition(() => {
			setFilters((current) => ({
				...current,
				window: nextWindow,
			}));
		});
	};
	const handleSurfaceChange = (value: string) => {
		const nextSurface = normalizeFilterValue(value);
		startTransition(() => {
			setFilters((current) => ({
				...current,
				surface: nextSurface,
			}));
		});
	};
	const handleSelectedCapabilityChange = (value: string) => {
		const nextTarget = normalizeFilterValue(value);
		startTransition(() => {
			setFilters((current) => ({
				...current,
				selectedCapability: nextTarget,
			}));
		});
	};

	return (
		<>
			<Title title={PANEL_COPY.menu.overview} />
			<PanelPage>
				<Stack spacing={3}>
					<OverviewHeaderSection
						asOf={asOf}
						filters={filters}
						isRefreshing={isRefreshing}
						onSelectedCapabilityChange={handleSelectedCapabilityChange}
						onSurfaceChange={handleSurfaceChange}
						onWindowChange={handleWindowChange}
					/>

					{isPending ? <OverviewLoadingGrid /> : null}

					{!isPending && primaryErrorMessage ? (
						<Alert severity="error">{primaryErrorMessage}</Alert>
					) : null}

					{!(isPending || primaryErrorMessage) && overviewRecord ? (
						<OverviewPrimaryContent
							costSeries={costSeries}
							overviewRecord={overviewRecord}
							qualitySeries={qualitySeries}
							runtimeDiagnostics={runtimeDiagnostics}
							runtimeErrorMessage={runtimeErrorMessage}
							runtimeIsPending={runtimeDiagnosticsQuery.isPending}
						/>
					) : null}
				</Stack>
			</PanelPage>
		</>
	);
}
