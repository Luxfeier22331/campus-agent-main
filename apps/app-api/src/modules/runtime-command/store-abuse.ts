import {
	ABUSE_THROTTLE_ACTIVE_WINDOW_MS,
	ABUSE_THROTTLE_ONE_MINUTE_WINDOW_MS,
	ABUSE_THROTTLE_REQUESTS_PER_MINUTE,
	ABUSE_THROTTLE_REQUESTS_PER_TEN_MINUTES,
	ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS,
	type AbuseThrottleReason,
} from "../safety-ops-policy";
import type { AbuseControlState } from "./store-types";

export function createEmptyAbuseControlState(): AbuseControlState {
	return {
		activeThrottleUntil: null,
		requestCountLastMinute: 0,
		requestCountLastTenMinutes: 0,
		shouldThrottle: false,
		throttleReason: null,
	};
}

export function deriveAbuseControlState(input: {
	now: string;
	rows: Array<{
		errorCode: string | null;
		startedAt: Date;
	}>;
}): AbuseControlState {
	const nowValue = new Date(input.now);
	const oneMinuteAgo = new Date(nowValue.valueOf() - ABUSE_THROTTLE_ONE_MINUTE_WINDOW_MS);
	const tenMinutesAgo = new Date(nowValue.valueOf() - ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS);
	const activeRows = input.rows.filter((row) => row.startedAt.valueOf() >= tenMinutesAgo.valueOf());
	const requestCountLastMinute = activeRows.filter(
		(row) => row.startedAt.valueOf() >= oneMinuteAgo.valueOf(),
	).length;
	const requestCountLastTenMinutes = activeRows.length;
	const activeThrottleUntilMs = activeRows.reduce((latestUntilMs, row) => {
		if (row.errorCode !== "rate_limit_exceeded") {
			return latestUntilMs;
		}

		const untilMs = row.startedAt.valueOf() + ABUSE_THROTTLE_ACTIVE_WINDOW_MS;
		if (untilMs <= nowValue.valueOf()) {
			return latestUntilMs;
		}

		return Math.max(latestUntilMs, untilMs);
	}, 0);

	let throttleReason: AbuseThrottleReason = null;
	if (activeThrottleUntilMs > 0) {
		throttleReason = "active_throttle_window";
	} else if (requestCountLastMinute > ABUSE_THROTTLE_REQUESTS_PER_MINUTE) {
		throttleReason = "requests_per_minute";
	} else if (requestCountLastTenMinutes > ABUSE_THROTTLE_REQUESTS_PER_TEN_MINUTES) {
		throttleReason = "requests_per_ten_minutes";
	}

	return {
		activeThrottleUntil:
			activeThrottleUntilMs > 0 ? new Date(activeThrottleUntilMs).toISOString() : null,
		requestCountLastMinute,
		requestCountLastTenMinutes,
		shouldThrottle: throttleReason !== null,
		throttleReason,
	};
}
