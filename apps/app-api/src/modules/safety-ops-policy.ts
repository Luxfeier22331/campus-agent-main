export const ABUSE_THROTTLE_REQUESTS_PER_MINUTE = 8;
export const ABUSE_THROTTLE_REQUESTS_PER_TEN_MINUTES = 30;
export const ABUSE_THROTTLE_ACTIVE_WINDOW_MS = 5 * 60_000;
export const ABUSE_THROTTLE_ONE_MINUTE_WINDOW_MS = 60_000;
export const ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS = 10 * 60_000;
export const SAFETY_ALERT_LOOKBACK_MS = 15 * 60_000;
export const SAFETY_ALERT_THRESHOLD = 3;

export type AbuseThrottleReason =
  | "active_throttle_window"
  | "requests_per_minute"
  | "requests_per_ten_minutes"
  | null;

export type SafetyAlertCode =
  | "safety.rate_limit_exceeded"
  | "safety.remote_content_suspicion_spike"
  | "safety.provider_content_filter_spike";

export interface SafetyIncidentBackfillHint {
  mode: "incident_backfill" | null;
  required: boolean;
}

export function buildIncidentBackfillHint(code: SafetyAlertCode): SafetyIncidentBackfillHint {
  if (
    code === "safety.remote_content_suspicion_spike" ||
    code === "safety.provider_content_filter_spike"
  ) {
    return {
      mode: "incident_backfill",
      required: true,
    };
  }

  return {
    mode: null,
    required: false,
  };
}
