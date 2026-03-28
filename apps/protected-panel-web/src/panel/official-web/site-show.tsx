import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";

import type { OfficialWebSiteRecord } from "../types";
import { formatTimestamp } from "./official-web-formatters";
import {
  OfficialWebHostsSummary,
  OfficialWebIngestionStatusChip,
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
          crawl runs. It is intentionally not an infrastructure console.
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
