export function formatOfficialWebStatusLabel(status: string) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "completed_with_errors":
      return "Completed with errors";
    case "failed":
      return "Failed";
    case "abandoned":
      return "Abandoned";
    default:
      return status;
  }
}

export function formatIngestionStatusLabel(status: string | null) {
  switch (status) {
    case "pending":
      return "Pending";
    case "queued":
      return "Queued";
    case "dispatched":
      return "Dispatched";
    case "ingestion_failed":
      return "Dispatch failed";
    case null:
      return "Not available";
    default:
      return status;
  }
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
