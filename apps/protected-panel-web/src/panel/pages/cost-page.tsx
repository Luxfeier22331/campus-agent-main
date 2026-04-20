import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
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
  TextField,
  Typography,
  MenuItem,
} from "@mui/material";
import { useQueries } from "@tanstack/react-query";
import { startTransition, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import {
  PANEL_COPY,
  formatPanelMicrousd,
  formatPanelTimestamp,
  translateRuntimeErrorMessage,
} from "../panel-copy";
import {
  formatSelectedTargetLabel,
  formatSurfaceLabel,
} from "../requests/request-formatters";
import type {
  OperatorCostSummaryRecord,
  OperatorOverviewWindow,
} from "../types";
import {
  buildCostModelDistributionEntries,
  buildCostSurfaceDistributionEntries,
  buildCostTrendSeries,
} from "./cost-domain";
import { resolveOverviewGranularity } from "./overview-domain";

type CostFilterState = {
  selectedTarget: string | null;
  surface: string | null;
  window: OperatorOverviewWindow;
};

type CostDistributionEntry = {
  estimatedCostUsd: number;
  key: string;
  label: string;
  requestCount: number;
  sharePct: number;
};

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
  { label: formatSelectedTargetLabel("rag-specialist"), value: "rag-specialist" },
];

function normalizeFilterValue(value: string) {
  return value.trim() ? value : null;
}

function formatOverviewWindowLabel(window: OperatorOverviewWindow) {
  return WINDOW_OPTIONS.find((option) => option.value === window)?.label ?? window;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTrendBucketLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(new Date(value));
}

function toQueryErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
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

function SummaryCard(props: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card
      sx={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,250,255,0.98) 100%)",
        borderRadius: 3,
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

function SectionCard(props: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <Card
      sx={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,251,255,0.99) 100%)",
        borderRadius: 3,
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

function buildSummaryCards(summary: OperatorCostSummaryRecord["summary"]) {
  const totalTokens =
    summary.tokens.input + summary.tokens.output + summary.tokens.cachedInput;
  const cachedShare = totalTokens > 0 ? (summary.tokens.cachedInput / totalTokens) * 100 : 0;

  return [
    {
      detail: PANEL_COPY.costPage.cardDetail.estimatedRealtime,
      label: PANEL_COPY.costPage.cards.estimatedCost,
      value: formatPanelMicrousd(summary.estimatedCost.microusd),
    },
    {
      detail: PANEL_COPY.costPage.cardDetail.requestTraffic,
      label: PANEL_COPY.costPage.cards.inputTokens,
      value: formatCount(summary.tokens.input),
    },
    {
      detail: PANEL_COPY.costPage.cardDetail.generatedTokens,
      label: PANEL_COPY.costPage.cards.outputTokens,
      value: formatCount(summary.tokens.output),
    },
    {
      detail: `${PANEL_COPY.costPage.cardDetail.cachedShare} ${cachedShare.toFixed(1)}%`,
      label: PANEL_COPY.costPage.cards.cachedInputTokens,
      value: formatCount(summary.tokens.cachedInput),
    },
  ];
}

function DistributionSection(props: {
  entries: CostDistributionEntry[];
  title: string;
  description: string;
}) {
  return (
    <SectionCard description={props.description} title={props.title}>
      {props.entries.length > 0 ? (
        <Stack spacing={2.5}>
          <BarChart
            height={280}
            margin={{ bottom: 36, left: 48, right: 24, top: 20 }}
            series={[
              {
                data: props.entries.map((entry) => entry.estimatedCostUsd),
                label: PANEL_COPY.costPage.distributions.costLabel,
                valueFormatter: (value) =>
                  value === null ? PANEL_COPY.unknown : `$${value.toFixed(4)}`,
              },
            ]}
            xAxis={[
              {
                data: props.entries.map((entry) => entry.label),
                scaleType: "band",
              },
            ]}
          />

          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{props.title}</TableCell>
                  <TableCell>{PANEL_COPY.costPage.distributions.costLabel}</TableCell>
                  <TableCell>{PANEL_COPY.costPage.distributions.requestCount}</TableCell>
                  <TableCell>{PANEL_COPY.costPage.distributions.share}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {props.entries.map((entry) => (
                  <TableRow key={entry.key}>
                    <TableCell>{entry.label}</TableCell>
                    <TableCell>{`$${entry.estimatedCostUsd.toFixed(4)}`}</TableCell>
                    <TableCell>{formatCount(entry.requestCount)}</TableCell>
                    <TableCell>{`${entry.sharePct}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Stack>
      ) : (
        <Alert severity="info">{PANEL_COPY.costPage.distributions.empty}</Alert>
      )}
    </SectionCard>
  );
}

export function CostPage() {
  useAuthenticated();
  const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
  const [filters, setFilters] = useState<CostFilterState>({
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
          dataProvider.getOperatorCostSummary({
            selectedTarget: deferredSelectedTarget,
            signal,
            surface: deferredSurface,
            window: deferredWindow,
          }),
        queryKey: [
          "protected-panel-cost-summary",
          deferredWindow,
          deferredSurface,
          deferredSelectedTarget,
        ] as const,
        staleTime: 30_000,
      },
      {
        queryFn: ({ signal }) =>
          dataProvider.getOperatorCostTimeseries({
            granularity: resolveOverviewGranularity(deferredWindow),
            selectedTarget: deferredSelectedTarget,
            signal,
            surface: deferredSurface,
            window: deferredWindow,
          }),
        queryKey: [
          "protected-panel-cost-timeseries-page",
          deferredWindow,
          resolveOverviewGranularity(deferredWindow),
          deferredSurface,
          deferredSelectedTarget,
        ] as const,
        staleTime: 30_000,
      },
    ] as const,
  });

  const summaryErrorMessage = summaryQuery.error
    ? toQueryErrorMessage(summaryQuery.error, PANEL_COPY.costPage.states.loadFailed)
    : null;
  const timeseriesErrorMessage = timeseriesQuery.error
    ? toQueryErrorMessage(timeseriesQuery.error, PANEL_COPY.costPage.states.loadFailed)
    : null;

  const summary = summaryQuery.data?.data ?? null;
  const timeseries = timeseriesQuery.data?.data ?? null;
  const summaryCards = summary ? buildSummaryCards(summary.summary) : [];
  const costSeries = timeseries ? buildCostTrendSeries(timeseries.series) : [];
  const byModelEntries = summary
    ? buildCostModelDistributionEntries(summary.summary.byModel)
    : [];
  const bySurfaceEntries = summary
    ? buildCostSurfaceDistributionEntries(summary.summary.bySurface)
    : [];

  const filterSummaryItems = useMemo(
    () => [
      `${PANEL_COPY.costPage.filterSummary.window}: ${formatOverviewWindowLabel(filters.window)}`,
      `${PANEL_COPY.costPage.filterSummary.surface}: ${
        filters.surface ? formatSurfaceLabel(filters.surface) : PANEL_COPY.overviewPage.filters.allSurfaces
      }`,
      `${PANEL_COPY.costPage.filterSummary.selectedTarget}: ${
        filters.selectedTarget
          ? formatSelectedTargetLabel(filters.selectedTarget)
          : PANEL_COPY.overviewPage.filters.allTargets
      }`,
    ],
    [filters.selectedTarget, filters.surface, filters.window],
  );

  return (
    <>
      <Title title={PANEL_COPY.menu.cost} />
      <Box sx={{ p: { md: 3, xs: 2 } }}>
        <Stack spacing={3}>
          <Card
            sx={{
              background:
                "linear-gradient(135deg, rgba(247,251,255,1) 0%, rgba(235,244,255,1) 100%)",
              borderRadius: 4,
            }}
            variant="outlined"
          >
            <CardContent>
              <Stack spacing={2.5}>
                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 700 }} variant="h4">
                    {PANEL_COPY.costPage.title}
                  </Typography>
                  <Typography color="text.secondary" variant="body1">
                    {PANEL_COPY.costPage.subtitle}
                  </Typography>
                </Stack>

                <Stack
                  direction={{ md: "row", xs: "column" }}
                  spacing={1.5}
                  sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
                >
                  <TextField
                    label={PANEL_COPY.costPage.filters.window}
                    onChange={(event) => {
                      const nextWindow = event.target.value as OperatorOverviewWindow;
                      startTransition(() => {
                        setFilters((current) => ({ ...current, window: nextWindow }));
                      });
                    }}
                    select
                    size="small"
                    value={filters.window}
                  >
                    {WINDOW_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={PANEL_COPY.costPage.filters.surface}
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
                    value={filters.surface ?? ""}
                  >
                    {SURFACE_OPTIONS.map((option) => (
                      <MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={PANEL_COPY.costPage.filters.selectedTarget}
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
                    value={filters.selectedTarget ?? ""}
                  >
                    {TARGET_OPTIONS.map((option) => (
                      <MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Stack spacing={0.5}>
                    <Typography color="text.secondary" variant="body2">
                      {PANEL_COPY.costPage.asOf}
                    </Typography>
                    <Typography sx={{ fontWeight: 600 }} variant="body2">
                      {summary?.asOf
                        ? formatPanelTimestamp(summary.asOf)
                        : timeseries?.asOf
                          ? formatPanelTimestamp(timeseries.asOf)
                          : PANEL_COPY.pending}
                    </Typography>
                  </Stack>
                </Stack>

                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                  {filterSummaryItems.map((item) => (
                    <Chip key={item} label={item} size="small" variant="outlined" />
                  ))}
                  {isRefreshing ? (
                    <Chip
                      color="info"
                      label={PANEL_COPY.costPage.refreshing}
                      size="small"
                      variant="outlined"
                    />
                  ) : null}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {summaryErrorMessage ? <Alert severity="error">{summaryErrorMessage}</Alert> : null}

          {summaryCards.length > 0 ? (
            <SectionCard
              description={PANEL_COPY.costPage.sections.summaryDescription}
              title={PANEL_COPY.costPage.sections.summary}
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
                {summaryCards.map((card) => (
                  <SummaryCard
                    detail={card.detail}
                    key={card.label}
                    label={card.label}
                    value={card.value}
                  />
                ))}
              </Box>
            </SectionCard>
          ) : null}

          <SectionCard
            description={PANEL_COPY.costPage.sections.timeseriesDescription}
            title={PANEL_COPY.costPage.sections.timeseries}
          >
            {timeseriesErrorMessage ? (
              <Alert severity="error">{timeseriesErrorMessage}</Alert>
            ) : costSeries.length > 0 ? (
              <Stack spacing={3}>
                <Stack spacing={1}>
                  <Typography color="text.secondary" variant="body2">
                    {PANEL_COPY.costPage.trends.costEstimate}
                  </Typography>
                  <LineChart
                    height={180}
                    margin={{ bottom: 24, left: 56, right: 16, top: 12 }}
                    series={[
                      {
                        data: costSeries.map((point) => point.estimatedCostUsd),
                        label: PANEL_COPY.costPage.trends.costEstimate,
                        showMark: false,
                        valueFormatter: (value) =>
                          value === null ? PANEL_COPY.unknown : `$${value.toFixed(4)}`,
                      },
                    ]}
                    xAxis={[
                      {
                        data: costSeries.map((point) => formatTrendBucketLabel(point.bucketEnd)),
                        scaleType: "point",
                      },
                    ]}
                  />
                </Stack>

                <Stack spacing={1}>
                  <Typography color="text.secondary" variant="body2">
                    {PANEL_COPY.costPage.trends.tokenUsage}
                  </Typography>
                  <LineChart
                    height={180}
                    margin={{ bottom: 24, left: 56, right: 16, top: 12 }}
                    series={[
                      {
                        data: costSeries.map((point) => point.totalTokens),
                        label: PANEL_COPY.costPage.trends.tokenUsage,
                        showMark: false,
                        valueFormatter: (value) =>
                          value === null ? PANEL_COPY.unknown : formatCount(value),
                      },
                    ]}
                    xAxis={[
                      {
                        data: costSeries.map((point) => formatTrendBucketLabel(point.bucketEnd)),
                        scaleType: "point",
                      },
                    ]}
                  />
                </Stack>
              </Stack>
            ) : (
              <Alert severity="info">{PANEL_COPY.costPage.trends.empty}</Alert>
            )}
          </SectionCard>

          <SectionCard
            description={PANEL_COPY.costPage.sections.distributions}
            title={PANEL_COPY.costPage.sections.distributions}
          >
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xl: "repeat(2, minmax(0, 1fr))",
                  xs: "1fr",
                },
              }}
            >
              <DistributionSection
                description={PANEL_COPY.costPage.sections.modelDistributionDescription}
                entries={byModelEntries}
                title={PANEL_COPY.costPage.sections.modelDistribution}
              />
              <DistributionSection
                description={PANEL_COPY.costPage.sections.surfaceDistributionDescription}
                entries={bySurfaceEntries}
                title={PANEL_COPY.costPage.sections.surfaceDistribution}
              />
            </Box>
          </SectionCard>
        </Stack>
      </Box>
    </>
  );
}
