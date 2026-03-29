import { Chip, Stack, Typography } from "@mui/material";

import type { RequestProjectionRecord } from "../types";
import {
  formatScope,
  formatStatusLabel,
  formatSurfaceLabel,
} from "./request-formatters";

function statusChipColor(
  status: string,
): "default" | "error" | "info" | "success" | "warning" {
  switch (status) {
    case "completed":
      return "success";
    case "needs_clarification":
    case "approval_required":
      return "warning";
    case "rejected":
    case "error":
      return "error";
    case "accepted":
      return "info";
    default:
      return "default";
  }
}

export function RequestStatusChip({ status }: { status: string }) {
  const color = statusChipColor(status);
  return (
    <Chip
      color={color}
      label={formatStatusLabel(status)}
      size="small"
      variant={color === "default" ? "outlined" : "filled"}
    />
  );
}

export function RequestActorSummary({
  record,
}: {
  record: RequestProjectionRecord;
}) {
  return (
    <Stack spacing={0.25}>
      <Typography fontWeight={500} variant="body2">
        {record.principalLabel || "Unnamed principal"}
      </Typography>
      <Typography color="text.secondary" variant="caption">
        {record.principalId}
      </Typography>
    </Stack>
  );
}

export function RequestPreviewText({
  emptyText,
  text,
}: {
  emptyText: string;
  text: string | null;
}) {
  if (!text || !text.trim()) {
    return (
      <Typography color="text.secondary" variant="body2">
        {emptyText}
      </Typography>
    );
  }

  return (
    <Typography
      sx={{
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 3,
        display: "-webkit-box",
        overflow: "hidden",
        whiteSpace: "normal",
      }}
      variant="body2"
    >
      {text}
    </Typography>
  );
}

export function RequestScopeSummary({
  record,
}: {
  record: RequestProjectionRecord;
}) {
  return (
    <Typography variant="body2">{formatScope(record.requestedScope)}</Typography>
  );
}

export function RequestSurfaceLabel({
  surface,
}: {
  surface: string;
}) {
  return <Typography variant="body2">{formatSurfaceLabel(surface)}</Typography>;
}

export function RequestSourceDocumentChips({
  sourceDocIds,
}: {
  sourceDocIds: string[];
}) {
  if (sourceDocIds.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No source documents captured.
      </Typography>
    );
  }

  return (
    <Stack direction="row" flexWrap="wrap" gap={1}>
      {sourceDocIds.map((docId) => (
        <Chip key={docId} label={docId} size="small" variant="outlined" />
      ))}
    </Stack>
  );
}
