import "@tanstack/history";

export type CampusAuthResultState =
	| { kind: "reset-complete" }
	| { kind: "account-deletion"; requestId: string; status: "deleting" }
	| {
			email: string;
			kind: "verification-delivery";
			retryAfterSeconds?: number;
			status: "sent" | "failed";
	  };

declare module "@tanstack/history" {
	interface HistoryState {
		campusAuthResult?: CampusAuthResultState;
	}
}

export function readCampusAuthResultState(value: unknown): CampusAuthResultState | undefined {
	if (!value || typeof value !== "object" || !("kind" in value)) {
		return;
	}
	if (value.kind === "reset-complete") {
		return { kind: "reset-complete" };
	}
	if (
		value.kind === "account-deletion" &&
		"requestId" in value &&
		typeof value.requestId === "string" &&
		value.requestId.trim().length > 0 &&
		value.requestId.length <= 128 &&
		"status" in value &&
		value.status === "deleting"
	) {
		return { kind: "account-deletion", requestId: value.requestId, status: "deleting" };
	}
	if (
		value.kind === "verification-delivery" &&
		"email" in value &&
		typeof value.email === "string" &&
		value.email.length <= 320 &&
		/^[^@\s]+@[^@\s]+$/u.test(value.email) &&
		"status" in value &&
		(value.status === "sent" || value.status === "failed")
	) {
		const retryAfterSeconds =
			"retryAfterSeconds" in value &&
			typeof value.retryAfterSeconds === "number" &&
			Number.isFinite(value.retryAfterSeconds) &&
			value.retryAfterSeconds > 0
				? Math.ceil(value.retryAfterSeconds)
				: undefined;
		return {
			email: value.email.trim().toLowerCase(),
			kind: "verification-delivery",
			...(retryAfterSeconds ? { retryAfterSeconds } : {}),
			status: value.status,
		};
	}
	return;
}
