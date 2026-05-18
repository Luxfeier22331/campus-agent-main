const RESEND_EMAILS_API_URL = "https://api.resend.com/emails";
const PASSWORD_RESET_ROUTE_PATH = "/account/reset-password";
const PASSWORD_RESET_SUBJECT = "Reset your Campus Agent password";
const PASSWORD_CHANGED_SUBJECT = "Your Campus Agent password was changed";

export interface AuthResetMailConfig {
	authShellOrigin: string;
	authResetEmailFrom: string;
	authResetEmailReplyTo?: string;
	fetchImplementation?: typeof fetch;
	publicChatOrigin: string;
	resendApiKey: string;
}

export interface AuthUserLike {
	email?: string | null;
	name?: string | null;
}

export interface PasswordResetRedirectInput {
	authShellOrigin: string;
	redirectTo: string;
}

interface PasswordResetEmailInput {
	token: string;
	user: AuthUserLike;
}

interface PasswordChangedEmailInput {
	user: AuthUserLike;
}

interface ResendEmailPayload {
	from: string;
	html: string;
	reply_to?: string;
	subject: string;
	text: string;
	to: string[];
}

function normalizeRecipientEmail(user: AuthUserLike): string {
	const email = user.email?.trim().toLowerCase();
	if (!email) {
		throw new Error("Password reset mail recipient is missing a valid email address.");
	}

	return email;
}

function formatRecipientName(user: AuthUserLike): string {
	const name = user.name?.trim();
	return name || "there";
}

export function resolvePasswordResetRedirectTarget(input: PasswordResetRedirectInput): string {
	const origin = new URL(input.authShellOrigin).origin;
	const target = new URL(input.redirectTo, origin);

	if (
		target.origin !== origin ||
		target.pathname !== PASSWORD_RESET_ROUTE_PATH ||
		target.search ||
		target.hash
	) {
		throw new Error(
			"Password reset redirect must point to /account/reset-password on the auth shell origin.",
		);
	}

	return target.toString();
}

export function buildCanonicalPasswordResetUrl(input: {
	authShellOrigin: string;
	publicChatOrigin: string;
	token: string;
}): string {
	const callbackURL = resolvePasswordResetRedirectTarget({
		authShellOrigin: input.authShellOrigin,
		redirectTo: PASSWORD_RESET_ROUTE_PATH,
	});
	const resetUrl = new URL(
		`/api/auth/reset-password/${encodeURIComponent(input.token)}`,
		input.publicChatOrigin,
	);
	resetUrl.searchParams.set("callbackURL", callbackURL);
	return resetUrl.toString();
}

function buildPasswordResetEmailPayload(
	config: AuthResetMailConfig,
	input: PasswordResetEmailInput,
): ResendEmailPayload {
	const recipientEmail = normalizeRecipientEmail(input.user);
	const recipientName = formatRecipientName(input.user);
	const resetUrl = buildCanonicalPasswordResetUrl({
		publicChatOrigin: config.publicChatOrigin,
		authShellOrigin: config.authShellOrigin,
		token: input.token,
	});

	return {
		from: config.authResetEmailFrom,
		html: [
			`<p>Hello ${recipientName},</p>`,
			"<p>We received a request to reset your Campus Agent password.</p>",
			`<p><a href="${resetUrl}">Reset your password</a></p>`,
			"<p>If you did not request this change, you can ignore this email.</p>",
		].join(""),
		reply_to: config.authResetEmailReplyTo,
		subject: PASSWORD_RESET_SUBJECT,
		text: [
			`Hello ${recipientName},`,
			"",
			"We received a request to reset your Campus Agent password.",
			`Reset your password: ${resetUrl}`,
			"",
			"If you did not request this change, you can ignore this email.",
		].join("\n"),
		to: [recipientEmail],
	};
}

function buildPasswordChangedEmailPayload(
	config: AuthResetMailConfig,
	input: PasswordChangedEmailInput,
): ResendEmailPayload {
	const recipientEmail = normalizeRecipientEmail(input.user);
	const recipientName = formatRecipientName(input.user);

	return {
		from: config.authResetEmailFrom,
		html: [
			`<p>Hello ${recipientName},</p>`,
			"<p>Your Campus Agent password was changed successfully.</p>",
			"<p>If you did not make this change, contact support immediately.</p>",
		].join(""),
		reply_to: config.authResetEmailReplyTo,
		subject: PASSWORD_CHANGED_SUBJECT,
		text: [
			`Hello ${recipientName},`,
			"",
			"Your Campus Agent password was changed successfully.",
			"If you did not make this change, contact support immediately.",
		].join("\n"),
		to: [recipientEmail],
	};
}

async function sendResendEmail(
	config: AuthResetMailConfig,
	payload: ResendEmailPayload,
): Promise<void> {
	const fetchImplementation = config.fetchImplementation ?? fetch;
	const response = await fetchImplementation(RESEND_EMAILS_API_URL, {
		body: JSON.stringify(payload),
		headers: {
			Authorization: `Bearer ${config.resendApiKey}`,
			"content-type": "application/json",
		},
		method: "POST",
	});

	if (response.ok) {
		return;
	}

	const detail = (await response.text()).trim();
	throw new Error(
		`Resend password email request failed (${response.status})${detail ? `: ${detail}` : "."}`,
	);
}

export async function sendPasswordResetEmail(
	config: AuthResetMailConfig,
	input: PasswordResetEmailInput,
): Promise<void> {
	await sendResendEmail(config, buildPasswordResetEmailPayload(config, input));
}

export async function sendPasswordChangedEmail(
	config: AuthResetMailConfig,
	input: PasswordChangedEmailInput,
): Promise<void> {
	await sendResendEmail(config, buildPasswordChangedEmailPayload(config, input));
}
