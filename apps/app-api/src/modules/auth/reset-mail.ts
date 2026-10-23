import {
	type EnvironmentLane,
	LANE_QUERY_PARAM,
	laneQueryValue,
} from "campus-contracts/environment-lanes";
import { escape as escapeHtml } from "html-escaper";
import { Resend } from "resend";

const PASSWORD_RESET_ROUTE_PATH = "/account/reset-password";
const EMAIL_VERIFICATION_CALLBACK_PATH = "/account/verify-email/result";
const AUTH_FEEDBACK_PATH = "/feedback?source=auth";
const DEFAULT_RETURN_TARGET = "/account";
const PRODUCT_NAME = "中央民族大学校园问答";
const AUTH_INTERMEDIARY_PATHS = new Set([
	"/account/change-password",
	"/account/deletion",
	"/account/forgot-password",
	"/account/login",
	"/account/register",
	"/account/reset-complete",
	"/account/reset-link-sent",
	"/account/reset-password",
	"/account/verify-email",
	EMAIL_VERIFICATION_CALLBACK_PATH,
]);

export type AuthEmailPurpose =
	| "access_invitation"
	| "email_change_confirmation"
	| "email_verification"
	| "password_changed"
	| "password_reset";

export interface AuthEmailMessage {
	from: string;
	html: string;
	replyTo: string;
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
	emailSender?: AuthEmailSender;
	// Deployed lanes share one hostname, so links must select the environment that issued them.
	lane?: EnvironmentLane;
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
	url: string;
	user: AuthUserLike;
}

interface PasswordChangedEmailInput {
	user: AuthUserLike;
}

interface VerificationEmailInput {
	token: string;
	url: string;
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

function emailHtml(input: {
	actionHref?: string;
	actionLabel?: string;
	feedbackHref?: string;
	paragraphs: string[];
}) {
	const paragraphs = input.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
	if (input.actionHref && input.actionLabel) {
		paragraphs.splice(
			Math.min(2, paragraphs.length),
			0,
			`<p><a href="${escapeHtml(input.actionHref)}">${escapeHtml(input.actionLabel)}</a></p>`,
			`<p>如果按钮无法打开，请复制此链接：<br><a href="${escapeHtml(input.actionHref)}">${escapeHtml(input.actionHref)}</a></p>`,
		);
	}
	if (input.feedbackHref) {
		paragraphs.push(
			`<p>需要帮助？请通过<a href="${escapeHtml(input.feedbackHref)}">问题反馈</a>联系我们。</p>`,
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

function hasEncodedBackslash(value: string): boolean {
	if (value.includes("\\")) {
		return true;
	}
	try {
		return decodeURIComponent(value).includes("\\");
	} catch {
		return true;
	}
}

function assertSameOriginUrl(value: string, origin: string, label: string): URL {
	if (!value.trim() || hasEncodedBackslash(value)) {
		throw new Error(`${label} is not a safe same-origin URL.`);
	}

	let target: URL;
	try {
		target = new URL(value, origin);
	} catch {
		throw new Error(`${label} is not a valid URL.`);
	}
	if (target.origin !== origin || target.username || target.password) {
		throw new Error(`${label} is not a safe same-origin URL.`);
	}
	return target;
}

function isAuthIntermediaryPath(pathname: string): boolean {
	return Array.from(AUTH_INTERMEDIARY_PATHS).some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	);
}

function resolveSafeReturnTarget(value: string, origin: string): string {
	const target = assertSameOriginUrl(value, origin, "Authentication return target");
	if (
		target.pathname === "/api" ||
		target.pathname.startsWith("/api/") ||
		isAuthIntermediaryPath(target.pathname)
	) {
		throw new Error("Authentication return target points to an intermediate or API route.");
	}
	return `${target.pathname}${target.search}${target.hash}`;
}

export function resolveEmailVerificationReturnTarget(
	callbackURL: string,
	authShellOrigin: string,
): string {
	const origin = new URL(authShellOrigin).origin;
	const callback = assertSameOriginUrl(
		callbackURL || DEFAULT_RETURN_TARGET,
		origin,
		"Verification callback",
	);
	if (callback.pathname !== EMAIL_VERIFICATION_CALLBACK_PATH) {
		return resolveSafeReturnTarget(callback.toString(), origin);
	}
	if (
		callback.hash ||
		Array.from(callback.searchParams.keys()).some((key) => key !== "redirectTo")
	) {
		throw new Error("Verification callback contains unsupported parameters.");
	}
	const returnTargets = callback.searchParams.getAll("redirectTo");
	if (returnTargets.length > 1) {
		throw new Error("Verification callback contains more than one return target.");
	}
	return resolveSafeReturnTarget(returnTargets[0] || DEFAULT_RETURN_TARGET, origin);
}

function verificationCallbackUrl(origin: string, returnTarget: string): string {
	const callback = new URL(EMAIL_VERIFICATION_CALLBACK_PATH, origin);
	callback.searchParams.set("redirectTo", returnTarget);
	return callback.toString();
}

export function resolvePasswordResetRedirectTarget(input: PasswordResetRedirectInput): string {
	const origin = new URL(input.authShellOrigin).origin;
	const target = assertSameOriginUrl(input.redirectTo, origin, "Password reset redirect");
	const unsupportedParameter = Array.from(target.searchParams.keys()).some(
		(key) => key !== "redirectTo",
	);
	const returnTargets = target.searchParams.getAll("redirectTo");

	if (
		target.pathname !== PASSWORD_RESET_ROUTE_PATH ||
		target.hash ||
		unsupportedParameter ||
		returnTargets.length > 1
	) {
		throw new Error(
			"Password reset redirect must point to /account/reset-password on the auth shell origin.",
		);
	}

	const canonicalTarget = new URL(PASSWORD_RESET_ROUTE_PATH, origin);
	if (returnTargets[0]) {
		canonicalTarget.searchParams.set(
			"redirectTo",
			resolveSafeReturnTarget(returnTargets[0], origin),
		);
	}
	return canonicalTarget.toString();
}

export function buildCanonicalPasswordResetUrl(input: {
	authShellOrigin: string;
	token: string;
	url: string;
}): string {
	const origin = new URL(input.authShellOrigin).origin;
	const providedUrl = assertSameOriginUrl(input.url, origin, "Better Auth password reset URL");
	const callbackURLs = providedUrl.searchParams.getAll("callbackURL");
	if (
		providedUrl.pathname !== `/reset-password/${encodeURIComponent(input.token)}` ||
		providedUrl.hash ||
		Array.from(providedUrl.searchParams.keys()).some((key) => key !== "callbackURL") ||
		callbackURLs.length !== 1
	) {
		throw new Error("Better Auth password reset URL does not match the expected action route.");
	}

	const callbackURL = resolvePasswordResetRedirectTarget({
		authShellOrigin: origin,
		redirectTo: callbackURLs[0] || PASSWORD_RESET_ROUTE_PATH,
	});
	const resetUrl = new URL(`/api/auth/reset-password/${encodeURIComponent(input.token)}`, origin);
	resetUrl.searchParams.set("callbackURL", callbackURL);
	return resetUrl.toString();
}

export function buildCanonicalEmailVerificationUrl(input: {
	authShellOrigin: string;
	callbackDestination: "return-target" | "verification-result";
	token: string;
	url: string;
}): string {
	const origin = new URL(input.authShellOrigin).origin;
	const providedUrl = assertSameOriginUrl(input.url, origin, "Better Auth verification URL");
	const callbackURLs = providedUrl.searchParams.getAll("callbackURL");
	if (
		providedUrl.pathname !== "/verify-email" ||
		providedUrl.hash ||
		providedUrl.searchParams.getAll("token").length !== 1 ||
		providedUrl.searchParams.get("token") !== input.token ||
		callbackURLs.length !== 1 ||
		Array.from(providedUrl.searchParams.keys()).some(
			(key) => key !== "callbackURL" && key !== "token",
		)
	) {
		throw new Error("Better Auth verification URL does not match the expected action route.");
	}

	const returnTarget = resolveEmailVerificationReturnTarget(
		callbackURLs[0] || DEFAULT_RETURN_TARGET,
		origin,
	);
	const verificationUrl = new URL("/api/auth/verify-email", origin);
	verificationUrl.searchParams.set("token", input.token);
	verificationUrl.searchParams.set(
		"callbackURL",
		input.callbackDestination === "verification-result"
			? verificationCallbackUrl(origin, returnTarget)
			: new URL(returnTarget, origin).toString(),
	);
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
		replyTo: config.authEmailFrom,
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

function authFeedbackUrl(config: AuthMailConfig): string {
	return withMailLane(config, new URL(AUTH_FEEDBACK_PATH, config.authShellOrigin).toString());
}

export function withMailLane(config: Pick<AuthMailConfig, "lane">, url: string): string {
	if (!config.lane) {
		return url;
	}
	const laneUrl = new URL(url);
	laneUrl.searchParams.set(LANE_QUERY_PARAM, laneQueryValue(config.lane));
	return laneUrl.toString();
}

export async function sendPasswordResetEmail(
	config: AuthMailConfig,
	input: PasswordResetEmailInput,
): Promise<void> {
	const recipient = normalizeRecipientEmail(input.user);
	const name = formatRecipientName(input.user);
	const url = withMailLane(
		config,
		buildCanonicalPasswordResetUrl({
			authShellOrigin: config.authShellOrigin,
			token: input.token,
			url: input.url,
		}),
	);
	const feedbackUrl = authFeedbackUrl(config);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "重置密码",
				feedbackHref: feedbackUrl,
				paragraphs: [
					`${name}，你好：`,
					`我们收到了重置${PRODUCT_NAME}密码的请求。此链接将在 1 小时后失效。`,
					"如果这不是你的操作，可以忽略这封邮件。",
				],
			}),
			subject: `重置${PRODUCT_NAME}密码`,
			text: `${name}，你好：\n\n请在 1 小时内通过以下链接重置${PRODUCT_NAME}密码：\n${url}\n\n如果这不是你的操作，可以忽略这封邮件。\n\n需要帮助？请访问：${feedbackUrl}`,
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
	const feedbackUrl = authFeedbackUrl(config);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				feedbackHref: feedbackUrl,
				paragraphs: [
					`${name}，你好：`,
					`你的${PRODUCT_NAME}密码已修改。`,
					"如果这不是你的操作，请立即联系维护者。",
				],
			}),
			subject: `${PRODUCT_NAME}密码已修改`,
			text: `${name}，你好：\n\n你的${PRODUCT_NAME}密码已修改。\n如果这不是你的操作，请立即通过问题反馈联系我们：${feedbackUrl}`,
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
	const url = withMailLane(
		config,
		buildCanonicalEmailVerificationUrl({
			authShellOrigin: config.authShellOrigin,
			callbackDestination: "verification-result",
			token: input.token,
			url: input.url,
		}),
	);
	const feedbackUrl = authFeedbackUrl(config);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "验证邮箱",
				feedbackHref: feedbackUrl,
				paragraphs: [
					`${name}，你好：`,
					`请验证此邮箱，以继续使用${PRODUCT_NAME}账号。此链接将在 1 小时后失效。`,
					"如果这不是你的操作，可以忽略这封邮件。",
				],
			}),
			subject: `验证${PRODUCT_NAME}邮箱`,
			text: `${name}，你好：\n\n请在 1 小时内通过以下链接验证邮箱：\n${url}\n\n如果这不是你的操作，可以忽略这封邮件。\n\n需要帮助？请访问：${feedbackUrl}`,
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
	const url = withMailLane(
		config,
		buildCanonicalEmailVerificationUrl({
			authShellOrigin: config.authShellOrigin,
			callbackDestination: "return-target",
			token: input.token,
			url: input.url,
		}),
	);
	const feedbackUrl = authFeedbackUrl(config);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "确认更换邮箱",
				feedbackHref: feedbackUrl,
				paragraphs: [
					`${name}，你好：`,
					`请确认将${PRODUCT_NAME}登录邮箱更换为 ${input.newEmail}。此链接将在 1 小时后失效。`,
					"如果这不是你的操作，请勿打开链接。",
				],
			}),
			subject: `确认更换${PRODUCT_NAME}邮箱`,
			text: `${name}，你好：\n\n请在 1 小时内确认将${PRODUCT_NAME}登录邮箱更换为 ${input.newEmail}：\n${url}\n\n如果这不是你的操作，请勿打开链接。\n\n需要帮助？请访问：${feedbackUrl}`,
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
	const url = withMailLane(
		config,
		buildAccessInvitationUrl({
			authShellOrigin: config.authShellOrigin,
			email: recipient,
		}),
	);
	const accessLabel = input.kind === "test" ? "测试资格" : "邀请资格";
	const feedbackUrl = authFeedbackUrl(config);
	await sendEmail(
		config,
		basePayload(config, {
			html: emailHtml({
				actionHref: url,
				actionLabel: "注册或登录",
				feedbackHref: feedbackUrl,
				paragraphs: [
					"你好：",
					`你已获得${PRODUCT_NAME}${accessLabel}。`,
					"登录前需要先验证这个邮箱。",
				],
			}),
			subject: `${PRODUCT_NAME}${accessLabel}`,
			text: `你好：\n\n你已获得${PRODUCT_NAME}${accessLabel}。\n请通过以下链接注册或登录：\n${url}\n\n登录前需要先验证这个邮箱。\n\n需要帮助？请访问：${feedbackUrl}`,
			to: recipient,
		}),
		{
			...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
			purpose: "access_invitation",
		},
	);
}
