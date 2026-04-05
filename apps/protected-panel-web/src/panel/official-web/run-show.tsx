import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";

import type { OfficialWebRunRecord } from "../types";
import { formatTimestamp } from "./official-web-formatters";
import {
  OfficialWebArtifactList,
  OfficialWebIngestionStatusChip,
  OfficialWebPageChangeChip,
  OfficialWebRunIntentChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

function RunFieldRow(props: { label: string; value: ReactNode }) {
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

function OfficialWebRunShowContent() {
  const record = useRecordContext<OfficialWebRunRecord>();

  if (!record) {
    return null;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Alert severity="info">
          This run detail is a projection snapshot from app-api. It shows crawl truth, artifact refs,
          and dispatch state without exposing raw infrastructure internals.
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
                <RunFieldRow label="Run ID" value={record.runId} />
                <RunFieldRow label="Site ID" value={record.siteId} />
                <RunFieldRow
                  label="Intent"
                  value={<OfficialWebRunIntentChip runIntent={record.runIntent} />}
                />
                <RunFieldRow
                  label="Status"
                  value={<OfficialWebRunStatusChip status={record.status} />}
                />
                <RunFieldRow
                  label="Dispatch"
                  value={<OfficialWebIngestionStatusChip status={record.ingestionDispatchStatus} />}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Lifecycle</Typography>
                <Divider />
                <RunFieldRow label="Started" value={formatTimestamp(record.startedAt)} />
                <RunFieldRow label="Last Heartbeat" value={formatTimestamp(record.lastHeartbeatAt)} />
                <RunFieldRow label="Finished" value={formatTimestamp(record.finishedAt)} />
                <RunFieldRow label="Projected" value={formatTimestamp(record.projectedAt)} />
                <RunFieldRow label="Failures" value={record.failureCount} />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Run Summary</Typography>
                <Divider />
                {record.summary ? (
                  <Stack spacing={0.75}>
                    {Object.entries(record.summary).map(([key, value]) => (
                      <RunFieldRow key={key} label={key} value={String(value)} />
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    No summary projected yet.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Page Change Summary</Typography>
                <Divider />
                {record.pageChangeSummary ? (
                  <Stack spacing={0.75}>
                    {Object.entries(record.pageChangeSummary).map(([key, value]) => (
                      <RunFieldRow key={key} label={key} value={String(value)} />
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    No page change summary projected yet.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Page Changes</Typography>
                <Divider />
                {record.pageChanges && record.pageChanges.length > 0 ? (
                  <Stack spacing={1.5}>
                    {record.pageChanges.map((change) => (
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
                    No page changes captured for this run.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Artifacts</Typography>
                <Divider />
                <OfficialWebArtifactList artifacts={record.artifacts} />
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}

export function OfficialWebRunShowPage() {
  return (
    <Show title="Official Web Crawl Run">
      <OfficialWebRunShowContent />
    </Show>
  );
}
