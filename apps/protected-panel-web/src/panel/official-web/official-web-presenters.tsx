import { Chip, Stack, Typography } from "@mui/material";

import type { OfficialWebArtifactRecord, OfficialWebRunRecord } from "../types";
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
