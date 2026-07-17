export const ABUSE_THROTTLE_REQUESTS_PER_MINUTE = 8;
export const ABUSE_THROTTLE_REQUESTS_PER_TEN_MINUTES = 30;
export const ABUSE_THROTTLE_ACTIVE_WINDOW_MS = 5 * 60_000;
export const ABUSE_THROTTLE_ONE_MINUTE_WINDOW_MS = 60_000;
export const ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS = 10 * 60_000;

export type AbuseThrottleReason =
	| "active_throttle_window"
	| "requests_per_minute"
	| "requests_per_ten_minutes"
	| null;
