import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";

import type { RequestProjectionRecord } from "../types";
import {
  buildRequestDiagnosticEntries,
  formatDuration,
  formatStatusLabel,
  formatSurfaceLabel,
  formatTimestamp,
} from "./request-formatters";
import {
  RequestActorSummary,
  RequestPreviewText,
  RequestScopeSummary,
  RequestSourceDocumentChips,
  RequestStatusChip,
} from "./request-presenters";

function RequestFieldRow(props: { label: string; value: ReactNode }) {
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

function RequestShowContent() {
  const record = useRecordContext<RequestProjectionRecord>();

  if (!record) {
    return null;
  }

  const diagnosticEntries = buildRequestDiagnosticEntries(record.diagnostics);

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Alert severity="info">
          This view shows the app-api request projection snapshot. It is intentionally a
          read model, not a live execution replay endpoint.
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
                <RequestFieldRow label="Request ID" value={record.requestId} />
                <RequestFieldRow label="Trace ID" value={record.traceId} />
                <RequestFieldRow
                  label="Status"
                  value={
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <RequestStatusChip status={record.status} />
                      <Typography color="text.secondary" variant="body2">
                        {formatStatusLabel(record.status)}
                      </Typography>
                    </Stack>
                  }
                />
                <RequestFieldRow
                  label="Surface"
                  value={formatSurfaceLabel(record.surface)}
                />
                <RequestFieldRow
                  label="Conversation"
                  value={record.conversationId || "Not attached"}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Principal and Routing</Typography>
                <Divider />
                <RequestFieldRow
                  label="Actor"
                  value={<RequestActorSummary record={record} />}
                />
                <RequestFieldRow label="Actor Type" value={record.principalType} />
                <RequestFieldRow
                  label="Capability"
                  value={record.requestedCapability || "Unspecified"}
                />
                <RequestFieldRow
                  label="Requested Scope"
                  value={<RequestScopeSummary record={record} />}
                />
                <RequestFieldRow
                  label="Selected Target"
                  value={record.selectedTarget || "Not selected"}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Content Snapshot</Typography>
                <Divider />
                <RequestFieldRow
                  label="Question Preview"
                  value={
                    <RequestPreviewText
                      emptyText="No question preview captured."
                      text={record.questionPreview}
                    />
                  }
                />
                <RequestFieldRow
                  label="Answer Preview"
                  value={
                    <RequestPreviewText
                      emptyText="No answer preview captured."
                      text={record.answerPreview}
                    />
                  }
                />
                <RequestFieldRow
                  label="Error Code"
                  value={record.errorCode || "None"}
                />
                <RequestFieldRow
                  label="Source Documents"
                  value={<RequestSourceDocumentChips sourceDocIds={record.sourceDocIds} />}
                />
              </Stack>
            </CardContent>
          </Card>

          {diagnosticEntries.length > 0 ? (
            <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Diagnostics</Typography>
                  <Divider />
                  {diagnosticEntries.map((entry) => (
                    <RequestFieldRow
                      key={entry.label}
                      label={entry.label}
                      value={entry.value}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Timing</Typography>
                <Divider />
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: {
                      md: "repeat(4, minmax(0, 1fr))",
                      xs: "1fr",
                    },
                  }}
                >
                  <RequestFieldRow
                    label="Started"
                    value={formatTimestamp(record.startedAt)}
                  />
                  <RequestFieldRow
                    label="Completed"
                    value={formatTimestamp(record.completedAt)}
                  />
                  <RequestFieldRow
                    label="Projected"
                    value={formatTimestamp(record.projectedAt)}
                  />
                  <RequestFieldRow
                    label="Duration"
                    value={formatDuration(record.durationMs)}
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}

export function RequestShowPage() {
  return (
    <Show title="Request Detail">
      <RequestShowContent />
    </Show>
  );
}
