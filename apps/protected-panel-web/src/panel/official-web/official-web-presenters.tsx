import { Chip, Stack, Typography } from "@mui/material";

import type {
  OfficialWebArtifactRecord,
  OfficialWebPageChangeRecord,
  OfficialWebRunRecord,
  OfficialWebSiteFreshnessSummary,
} from "../types";
import { formatIngestionStatusLabel, formatOfficialWebStatusLabel } from "./official-web-formatters";

function toStatusColor(status: string) {
  switch (status) {
    case "completed":
    case "dispatched":
      return "success" as const;
    case "completed_with_errors":
    case "queued":
      return "warning" as const;
    case "failed":
    case "abandoned":
    case "ingestion_failed":
      return "error" as const;
    default:
      return "default" as const;
  }
}

export function OfficialWebRunStatusChip({ status }: { status: string }) {
  return <Chip color={toStatusColor(status)} label={formatOfficialWebStatusLabel(status)} size="small" />;
}

export function OfficialWebIngestionStatusChip({ status }: { status: string | null }) {
  return (
    <Chip
      color={toStatusColor(status ?? "default")}
      label={formatIngestionStatusLabel(status)}
      size="small"
      variant={status === "dispatched" ? "filled" : "outlined"}
    />
  );
}

export function OfficialWebRunIntentChip({ runIntent }: { runIntent: OfficialWebRunRecord["runIntent"] }) {
  const label =
    runIntent === "baseline" ? "Baseline" : runIntent === "hot" ? "Hot" : "Repair";

  return <Chip color={runIntent === "repair" ? "warning" : "default"} label={label} size="small" />;
}

export function OfficialWebHostsSummary({ hostRoots }: { hostRoots: string[] }) {
  return (
    <Typography variant="body2">
      {hostRoots.length > 0 ? hostRoots.join(", ") : "No hosts projected"}
    </Typography>
  );
}

export function OfficialWebFailureSummary({ record }: { record: OfficialWebRunRecord }) {
  return <Typography variant="body2">{record.failureCount}</Typography>;
}

export function OfficialWebArtifactList({ artifacts }: { artifacts: OfficialWebArtifactRecord[] }) {
  if (artifacts.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No artifacts registered.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {artifacts.map((artifact) => (
        <Stack key={`${artifact.artifactType}:${artifact.objectKey}`} spacing={0.25}>
          <Typography variant="body2">
            <strong>{artifact.artifactType}</strong>
          </Typography>
          <Typography color="text.secondary" sx={{ wordBreak: "break-all" }} variant="caption">
            {artifact.objectKey}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function OfficialWebPageChangeChip({ change }: { change: OfficialWebPageChangeRecord }) {
  return (
    <Chip
      color={change.changeStatus === "changed" || change.changeStatus === "new" ? "warning" : change.changeStatus === "deleted" || change.changeStatus === "fetch_failed" ? "error" : "default"}
      label={change.changeStatus}
      size="small"
      variant={change.changeStatus === "fetch_failed" ? "filled" : "outlined"}
    />
  );
}

export function OfficialWebFreshnessSummaryGrid({
  summary,
}: {
  summary: OfficialWebSiteFreshnessSummary;
}) {
  const rows = [
    ["Total Pages", summary.totalPages],
    ["Due Now", summary.duePages],
    ["Hot Pages", summary.hotPages],
    ["Repair Pages", summary.repairPages],
    ["Failed Fetch", summary.failedFetchPages],
    ["Changed 24h", summary.changedLast24h],
    ["Deleted", summary.deletedPages],
  ] as const;

  return (
    <Stack
      sx={{
        display: "grid",
        gap: 1,
        gridTemplateColumns: {
          md: "repeat(3, minmax(0, 1fr))",
          xs: "repeat(2, minmax(0, 1fr))",
        },
      }}
    >
      {rows.map(([label, value]) => (
        <Stack
          key={label}
          spacing={0.25}
          sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.5 }}
        >
          <Typography color="text.secondary" variant="caption">
            {label}
          </Typography>
          <Typography variant="h6">{value}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}
