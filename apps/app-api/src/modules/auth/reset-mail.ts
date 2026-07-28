import { escape as escapeHtml } from "html-escaper";
import { Resend } from "resend";

const PASSWORD_RESET_ROUTE_PATH = "/account/reset-password";
const EMAIL_VERIFICATION_CALLBACK_PATH = "/account/login";

export type AuthEmailPurpose =
	| "access_invitation"
	| "email_change_confirmation"
	| "email_verification"
	| "password_changed"
	| "password_reset";

export interface AuthEmailMessage {
	from: string;
	html: string;
	replyTo?: string;
	subject: string;
	text: string;
	to: string;
}

export interface AuthEmailSender {
	send(
		message: AuthEmailMessage,
		options: { idempotencyKey?: string; purpose: AuthEmailPurpose },
	): Promise<{ id: string }>;
}

export interface AuthMailConfig {
	authShellOrigin: string;
	authEmailFrom: string;
	authEmailReplyTo?: string;
	emailSender?: AuthEmailSender;
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

interface VerificationEmailInput {
	token: string;
	user: AuthUserLike;
}

interface EmailChangeConfirmationInput extends VerificationEmailInput {
	newEmail: string;
}

export interface AccessInvitationEmailInput {
	email: string;
	idempotencyKey?: string;
	kind: "invitation" | "test";
}

function normalizeRecipientEmail(user: AuthUserLike): string {
	const email = user.email?.trim().toLowerCase();
	if (!email) {
		throw new Error("Authentication email recipient is missing a valid email address.");
	}
	return email;
}

function formatRecipientName(user: AuthUserLike): string {
	return user.name?.trim() || "同学";
}

function emailHtml(input: { actionHref?: string; actionLabel?: string; paragraphs: string[] }) {
	const paragraphs = input.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
	if (input.actionHref && input.actionLabel) {
		paragraphs.splice(
			Math.min(2, paragraphs.length),
			0,
			`<p><a href="${escapeHtml(input.actionHref)}">${escapeHtml(input.actionLabel)}</a></p>`,
		);
	}
	return ['<!doctype html><html lang="zh-CN"><body>', ...paragraphs, "</body></html>"].join("");
}

export function createResendEmailSender(apiKey: string): AuthEmailSender {
	const resend = new Resend(apiKey);
	return {
		async send(message, options) {
			const response = await resend.emails.send(
				{
					from: message.from,
					html: message.html,
					replyTo: message.replyTo,
					subject: message.subject,
					tags: [
						{ name: "app", value: "campus-agent" },
						{ name: "purpose", value: options.purpose },
					],
					text: message.text,
					to: [message.to],
				},
				options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
			);
			if (response.error) {
				throw new Error(
					`Resend rejected the authentication email (${response.error.name}): ${response.error.message}`,
				);
			}
			if (!response.data?.id) {
				throw new Error("Resend accepted the request without returning an email id.");
			}
			return { id: response.data.id };
		},
	};
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
	token: string;
}): string {
	const callbackURL = resolvePasswordResetRedirectTarget({
		authShellOrigin: input.authShellOrigin,
		redirectTo: PASSWORD_RESET_ROUTE_PATH,
	});
	const resetUrl = new URL(
		`/api/auth/reset-password/${encodeURIComponent(input.token)}`,
		input.authShellOrigin,
	);
	resetUrl.searchParams.set("callbackURL", callbackURL);
	return resetUrl.toString();
}

export function buildCanonicalEmailVerificationUrl(input: {
	authShellOrigin: string;
	token: string;
}): string {
	const verificationUrl = new URL(
		`/api/auth/verify-email?token=${encodeURIComponent(input.token)}`,
		input.authShellOrigin,
	);
	verificationUrl.searchParams.set("callbackURL", EMAIL_VERIFICATION_CALLBACK_PATH);
	return verificationUrl.toString();
}

export function buildAccessInvitationUrl(input: {
	authShellOrigin: string;
	email: string;
}): string {
	const url = new URL("/account/register", input.authShellOrigin);
	url.searchParams.set("email", input.email.trim().toLowerCase());
	return url.toString();
}

function basePayload(
	config: AuthMailConfig,
	input: { html: string; subject: string; text: string; to: string },
): AuthEmailMessage {
	return {
		from: config.authEmailFrom,
		html: input.html,
		replyTo: config.authEmailReplyTo,
		subject: input.subject,
		text: input.text,
		to: input.to,
	};
}

async function sendEmail(
	config: AuthMailConfig,
	payload: AuthEmailMessage,
	options: { idempotencyKey?: string; purpose: AuthEmailPurpose },
): Promise<void> {
	const sender = config.emailSender ?? createResendEmailSender(config.resendApiKey);
	await sender.send(payload, options);
}

async function tokenIdempotencyKey(purpose: AuthEmailPurpose, token: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${purpose}:${token}`),
	);
	const hash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `campus-auth/${purpose}/${hash}`;
}

export async function sendPasswordResetEmail(
	config: AuthMailConfig,
	input: PasswordResetEmailInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail(input.user);
	const name = formatRecipientName(input.user);
	const url = buildCanonicalPasswordResetUrl({
		authShellOrigin: config.authShellOrigin,
		token: input.token,
	});
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "重置密码",
				paragraphs: [
					`${name}，你好：`,
					"我们收到了重置 Campus Agent 密码的请求。",
					"如果这不是你的操作，可以忽略这封邮件。",
				],
			}),
			subject: "重置 Campus Agent 密码",
			text: `${name}，你好：\n\n请通过以下链接重置 Campus Agent 密码：\n${url}\n\n如果这不是你的操作，可以忽略这封邮件。`,
			to: recipient,
		}),
		{
			idempotencyKey: await tokenIdempotencyKey("password_reset", input.token),
			purpose: "password_reset",
		},
	);
}

export async function sendPasswordChangedEmail(
	config: AuthMailConfig,
	input: PasswordChangedEmailInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail(input.user);
	const name = formatRecipientName(input.user);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				paragraphs: [
					`${name}，你好：`,
					"你的 Campus Agent 密码已修改。",
					"如果这不是你的操作，请立即联系维护者。",
				],
			}),
			subject: "Campus Agent 密码已修改",
			text: `${name}，你好：\n\n你的 Campus Agent 密码已修改。\n如果这不是你的操作，请立即联系维护者。`,
			to: recipient,
		}),
		{ purpose: "password_changed" },
	);
}

export async function sendVerificationEmail(
	config: AuthMailConfig,
	input: VerificationEmailInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail(input.user);
	const name = formatRecipientName(input.user);
	const url = buildCanonicalEmailVerificationUrl({
		authShellOrigin: config.authShellOrigin,
		token: input.token,
	});
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "验证邮箱",
				paragraphs: [
					`${name}，你好：`,
					"请验证邮箱，以完成 Campus Agent 账号注册。",
					"如果你没有注册账号，可以忽略这封邮件。",
				],
			}),
			subject: "验证 Campus Agent 邮箱",
			text: `${name}，你好：\n\n请通过以下链接验证邮箱：\n${url}\n\n如果你没有注册账号，可以忽略这封邮件。`,
			to: recipient,
		}),
		{
			idempotencyKey: await tokenIdempotencyKey("email_verification", input.token),
			purpose: "email_verification",
		},
	);
}

export async function sendEmailChangeConfirmation(
	config: AuthMailConfig,
	input: EmailChangeConfirmationInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail(input.user);
	const name = formatRecipientName(input.user);
	const url = buildCanonicalEmailVerificationUrl({
		authShellOrigin: config.authShellOrigin,
		token: input.token,
	});
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "确认更换邮箱",
				paragraphs: [
					`${name}，你好：`,
					`请确认将 Campus Agent 登录邮箱更换为 ${input.newEmail}。`,
					"如果这不是你的操作，请勿打开链接。",
				],
			}),
			subject: "确认更换 Campus Agent 邮箱",
			text: `${name}，你好：\n\n请确认将 Campus Agent 登录邮箱更换为 ${input.newEmail}：\n${url}\n\n如果这不是你的操作，请勿打开链接。`,
			to: recipient,
		}),
		{
			idempotencyKey: await tokenIdempotencyKey("email_change_confirmation", input.token),
			purpose: "email_change_confirmation",
		},
	);
}

export async function sendAccessInvitationEmail(
	config: AuthMailConfig,
	input: AccessInvitationEmailInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail({ email: input.email });
	const url = buildAccessInvitationUrl({
		authShellOrigin: config.authShellOrigin,
		email: recipient,
	});
	const accessLabel = input.kind === "test" ? "测试资格" : "邀请资格";
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "注册或登录",
				paragraphs: [
					"你好：",
					`你已获得 Campus Agent ${accessLabel}。`,
					"登录前需要先验证这个邮箱。",
				],
			}),
			subject: `Campus Agent ${accessLabel}`,
			text: `你好：\n\n你已获得 Campus Agent ${accessLabel}。\n请通过以下链接注册或登录：\n${url}\n\n登录前需要先验证这个邮箱。`,
			to: recipient,
		}),
		{ idempotencyKey: input.idempotencyKey, purpose: "access_invitation" },
	);
}
