import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";

import type { OfficialWebFreshnessPageRecord, OfficialWebSiteRecord } from "../types";
import { formatTimestamp } from "./official-web-formatters";
import {
  OfficialWebFreshnessSummaryGrid,
  OfficialWebHostsSummary,
  OfficialWebIngestionStatusChip,
  OfficialWebPageChangeChip,
  OfficialWebRunIntentChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

function SiteFieldRow(props: { label: string; value: ReactNode }) {
  return (
    <Stack spacing={0.5}>
      <Typography color="text.secondary" variant="caption">
        {props.label}
      </Typography>
      <Typography component="div" variant="body2">
        {props.value}
      </Typography>
    </Stack>
  );
}

function formatFreshnessTiming(page: OfficialWebFreshnessPageRecord) {
  if (page.lastFetchDisposition === "deleted") {
    return `Last seen ${formatTimestamp(page.lastSeenAt)}`;
  }
  if (page.lastFetchDisposition === "fetch_failed") {
    return `Retry after ${formatTimestamp(page.nextEligibleFetchAt)}`;
  }

  return `Next eligible ${formatTimestamp(page.nextEligibleFetchAt)}`;
}

function FreshnessBacklogSection(props: {
  emptyLabel: string;
  pages: OfficialWebFreshnessPageRecord[] | undefined;
  title: string;
}) {
  const pages = props.pages ?? [];

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{props.title}</Typography>
          <Divider />
          {pages.length > 0 ? (
            <Stack spacing={1.5}>
              {pages.map((page) => (
                <Stack key={`${page.siteId}:${page.normalizedCanonicalUrl}`} spacing={0.5}>
                  <Typography variant="body2">{page.pageTitleNormalized || page.normalizedCanonicalUrl}</Typography>
                  <Typography sx={{ wordBreak: "break-all" }} variant="body2">
                    {page.normalizedCanonicalUrl}
                  </Typography>
                  <Typography color="text.secondary" variant="caption">
                    {page.host} • {page.pageFamily} • {page.cadenceClass} • priority {page.priorityScore}
                  </Typography>
                  <Typography color="text.secondary" variant="caption">
                    {page.lastChangeReason} • {formatFreshnessTiming(page)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary" variant="body2">
              {props.emptyLabel}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function OfficialWebSiteShowContent() {
  const record = useRecordContext<OfficialWebSiteRecord>();

  if (!record) {
    return null;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Alert severity="info">
          This view shows the app-api owned official_web site projection and the latest projected
          crawl runs plus the page_freshness backlog that the control plane will hand to future
          collector runs. It is intentionally not an infrastructure console.
        </Alert>

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
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Identity</Typography>
                <Divider />
                <SiteFieldRow label="Site ID" value={record.siteId} />
                <SiteFieldRow label="Display Name" value={record.displayName} />
                <SiteFieldRow label="Hosts" value={<OfficialWebHostsSummary hostRoots={record.hostRoots} />} />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Latest Projection</Typography>
                <Divider />
                <SiteFieldRow label="Latest Run" value={record.latestRunId || "No runs"} />
                <SiteFieldRow
                  label="Latest Status"
                  value={
                    record.latestRunStatus ? (
                      <OfficialWebRunStatusChip status={record.latestRunStatus} />
                    ) : (
                      "No runs"
                    )
                  }
                />
                <SiteFieldRow
                  label="Dispatch"
                  value={<OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />}
                />
                <SiteFieldRow label="Last Success" value={formatTimestamp(record.lastSuccessAt)} />
                <SiteFieldRow label="Last Failure" value={formatTimestamp(record.lastFailureAt)} />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Freshness</Typography>
                <Divider />
                {record.freshnessSummary ? (
                  <OfficialWebFreshnessSummaryGrid summary={record.freshnessSummary} />
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    No freshness summary projected yet.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridColumn: { lg: "1 / -1", xs: "auto" },
              gridTemplateColumns: {
                lg: "repeat(2, minmax(0, 1fr))",
                xs: "1fr",
              },
            }}
          >
            <FreshnessBacklogSection
              emptyLabel="No due pages projected."
              pages={record.freshnessBacklog?.duePages}
              title="Due Now"
            />
            <FreshnessBacklogSection
              emptyLabel="No hot-lane pages projected."
              pages={record.freshnessBacklog?.hotPages}
              title="Hot Lane"
            />
            <FreshnessBacklogSection
              emptyLabel="No failed-fetch backlog projected."
              pages={record.freshnessBacklog?.failedFetchPages}
              title="Failed Fetch"
            />
            <FreshnessBacklogSection
              emptyLabel="No deleted pages projected."
              pages={record.freshnessBacklog?.deletedPages}
              title="Deleted"
            />
          </Box>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Recent Runs</Typography>
                <Divider />
                {record.recentRuns && record.recentRuns.length > 0 ? (
                  <Stack spacing={1.5}>
                    {record.recentRuns.map((run) => (
                      <Stack key={run.runId} spacing={0.5}>
                        <Typography variant="body2">
                          <strong>{run.runId}</strong>
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <OfficialWebRunIntentChip runIntent={run.runIntent} />
                          <OfficialWebRunStatusChip status={run.status} />
                          <OfficialWebIngestionStatusChip status={run.ingestionDispatchStatus} />
                          <Typography color="text.secondary" variant="caption">
                            Started {formatTimestamp(run.startedAt)}
                          </Typography>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    No recent runs projected yet.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Recent Page Changes</Typography>
                <Divider />
                {record.recentPageChanges && record.recentPageChanges.length > 0 ? (
                  <Stack spacing={1.5}>
                    {record.recentPageChanges.map((change) => (
                      <Stack key={change.id} spacing={0.5}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <OfficialWebPageChangeChip change={change} />
                          <Typography variant="body2">{change.pageTitleNormalized}</Typography>
                          <Typography color="text.secondary" variant="caption">
                            {change.pageFamily}
                          </Typography>
                        </Stack>
                        <Typography sx={{ wordBreak: "break-all" }} variant="body2">
                          {change.normalizedCanonicalUrl}
                        </Typography>
                        <Typography color="text.secondary" variant="caption">
                          {change.lastChangeReason} at {formatTimestamp(change.observedAt)}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    No recent page changes projected yet.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}

export function OfficialWebSiteShowPage() {
  return (
    <Show title="Official Web Site">
      <OfficialWebSiteShowContent />
    </Show>
  );
}
