import { type ReactNode, startTransition, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Show, useDataProvider, useRecordContext } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
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

function formatBoolean(value: boolean | null) {
  if (value === null) {
    return "Unknown";
  }

  return value ? "Yes" : "No";
}

function formatMicrousd(value: number | null) {
  if (value === null) {
    return "Unknown";
  }

  return `$${(value / 1_000_000).toFixed(4)} USD`;
}

function linkValue(href: string | null, label: string) {
  if (!href) {
    return "Not available";
  }

  return (
    <Link href={href} rel="noreferrer" target="_blank" underline="hover">
      {label}
    </Link>
  );
}

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
  const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
  const record = useRecordContext<RequestProjectionRecord>();
  const [isObservabilityLoading, setIsObservabilityLoading] = useState(false);
  const [observabilityError, setObservabilityError] = useState<string | null>(null);
  const [observabilityRecord, setObservabilityRecord] = useState<
    Awaited<ReturnType<ProtectedPanelDataProvider["getRequestObservability"]>>["data"] | null
  >(null);
  const getRequestObservabilityRef = useRef(dataProvider.getRequestObservability);

  useEffect(() => {
    getRequestObservabilityRef.current = dataProvider.getRequestObservability;
  }, [dataProvider.getRequestObservability]);

  useEffect(() => {
    if (!record?.requestId) {
      return;
    }

    const controller = new AbortController();

    startTransition(() => {
      setIsObservabilityLoading(true);
      setObservabilityError(null);
      setObservabilityRecord(null);
    });

    void (async () => {
      try {
        const response = await getRequestObservabilityRef.current({
          requestId: record.requestId,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        startTransition(() => {
          setObservabilityRecord(response.data);
          setIsObservabilityLoading(false);
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        startTransition(() => {
          setObservabilityError(
            error instanceof Error ? error.message : "Failed to load request observability detail.",
          );
          setIsObservabilityLoading(false);
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [record?.requestId]);

  if (!record) {
    return null;
  }

  const diagnosticEntries = buildRequestDiagnosticEntries(record.diagnostics);
  const observability = observabilityRecord?.observability ?? null;
  const links = observabilityRecord?.links ?? null;
  const auditSummary = observabilityRecord?.auditSummary ?? null;

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
                <Typography variant="h6">Observability</Typography>
                <Divider />

                {isObservabilityLoading ? (
                  <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 160 }}>
                    <CircularProgress size={28} />
                  </Stack>
                ) : null}

                {!isObservabilityLoading && observabilityError ? (
                  <Alert severity="warning">{observabilityError}</Alert>
                ) : null}

                {!isObservabilityLoading && observability ? (
                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: {
                        lg: "repeat(3, minmax(0, 1fr))",
                        xs: "1fr",
                      },
                    }}
                  >
                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="Retrieval Attempted"
                        value={formatBoolean(observability.retrievalAttempted)}
                      />
                      <RequestFieldRow
                        label="Candidate Count"
                        value={observability.candidateCount ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Retrieved Sources"
                        value={observability.retrievedSourceCount ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Empty Recall"
                        value={formatBoolean(observability.emptyRecall)}
                      />
                      <RequestFieldRow
                        label="Citation Expected"
                        value={formatBoolean(observability.citationExpected)}
                      />
                      <RequestFieldRow
                        label="Citation Missing"
                        value={formatBoolean(observability.citationMissing)}
                      />
                      <RequestFieldRow
                        label="Citation Count"
                        value={observability.citationCount ?? "Unknown"}
                      />
                    </Stack>

                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="Model"
                        value={
                          observability.model.provider || observability.model.name
                            ? `${observability.model.provider || "unknown"} / ${observability.model.name || "unknown"}`
                            : "Unknown"
                        }
                      />
                      <RequestFieldRow
                        label="Input Tokens"
                        value={observability.inputTokens ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Output Tokens"
                        value={observability.outputTokens ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Cached Input Tokens"
                        value={observability.cachedInputTokens ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Estimated Cost"
                        value={formatMicrousd(observability.estimatedCost.microusd)}
                      />
                      <RequestFieldRow
                        label="Projection Lag"
                        value={formatDuration(observability.projectionLagMs)}
                      />
                      <RequestFieldRow
                        label="Measured At"
                        value={formatTimestamp(observability.measuredAt)}
                      />
                    </Stack>

                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="ACL Decision"
                        value={observability.aclDecision || "Unknown"}
                      />
                      <RequestFieldRow
                        label="ACL Anomaly"
                        value={observability.aclAnomalyCode || "None"}
                      />
                      <RequestFieldRow
                        label="Fail Closed"
                        value={formatBoolean(observability.failClosed)}
                      />
                      <RequestFieldRow
                        label="Refusal Class"
                        value={observability.refusalClass || "None"}
                      />
                      <RequestFieldRow
                        label="Trace Available"
                        value={formatBoolean(observability.traceAvailable)}
                      />
                      <RequestFieldRow
                        label="Trace Link"
                        value={linkValue(links?.traceLink ?? null, "Open trace")}
                      />
                      <RequestFieldRow
                        label="Issue Link"
                        value={linkValue(links?.issueLink ?? null, "Open issue")}
                      />
                      <RequestFieldRow
                        label="Issue Fingerprint"
                        value={links?.issueFingerprint || "Not available"}
                      />
                      <RequestFieldRow
                        label="Audit Events"
                        value={auditSummary?.auditEventCount ?? "Unknown"}
                      />
                      <RequestFieldRow
                        label="Latest Terminal Code"
                        value={auditSummary?.latestTerminalCode || "Unknown"}
                      />
                    </Stack>
                  </Box>
                ) : null}
              </Stack>
            </CardContent>
          </Card>

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
