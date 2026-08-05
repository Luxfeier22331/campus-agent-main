const VERIFICATION_SEND_STATE_KEY = "campus-auth.verification-email";
export const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;

interface VerificationSendState {
	email: string;
	sentAt: number;
}

export function normalizeAuthEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function recordVerificationEmailSent(email: string, sentAt = Date.now()): void {
	try {
		window.sessionStorage.setItem(
			VERIFICATION_SEND_STATE_KEY,
			JSON.stringify({ email: normalizeAuthEmail(email), sentAt } satisfies VerificationSendState),
		);
	} catch {
		return;
	}
}

export function readVerificationEmailSendState(): VerificationSendState | null {
	try {
		const raw = window.sessionStorage.getItem(VERIFICATION_SEND_STATE_KEY);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<VerificationSendState>;
		if (
			typeof parsed.email !== "string" ||
			!parsed.email ||
			typeof parsed.sentAt !== "number" ||
			!Number.isFinite(parsed.sentAt)
		) {
			return null;
		}
		return { email: normalizeAuthEmail(parsed.email), sentAt: parsed.sentAt };
	} catch {
		return null;
	}
}

export function verificationCooldownSeconds(email: string, now = Date.now()): number {
	const state = readVerificationEmailSendState();
	if (!state || state.email !== normalizeAuthEmail(email)) {
		return 0;
	}
	return Math.max(0, Math.ceil((state.sentAt + VERIFICATION_RESEND_COOLDOWN_MS - now) / 1000));
}
