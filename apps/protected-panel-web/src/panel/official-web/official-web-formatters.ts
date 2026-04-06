import { PANEL_COPY, formatPanelTimestamp } from "../panel-copy";

export function formatOfficialWebStatusLabel(status: string) {
  switch (status) {
    case "accepted":
      return PANEL_COPY.officialWebStatus.accepted;
    case "running":
      return PANEL_COPY.officialWebStatus.running;
    case "completed":
      return PANEL_COPY.officialWebStatus.completed;
    case "completed_with_errors":
      return PANEL_COPY.officialWebStatus.completed_with_errors;
    case "failed":
      return PANEL_COPY.officialWebStatus.failed;
    case "abandoned":
      return PANEL_COPY.officialWebStatus.abandoned;
    default:
      return status;
  }
}

export function formatIngestionStatusLabel(status: string | null) {
  switch (status) {
    case "pending":
      return PANEL_COPY.ingestionStatus.pending;
    case "queued":
      return PANEL_COPY.ingestionStatus.queued;
    case "dispatched":
      return PANEL_COPY.ingestionStatus.dispatched;
    case "ingestion_failed":
      return PANEL_COPY.ingestionStatus.ingestion_failed;
    case null:
      return PANEL_COPY.notAvailable;
    default:
      return status;
  }
}

export function formatTimestamp(value: string | null) {
  return formatPanelTimestamp(value);
}
