// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveDeploymentLane } from "../src/config";
import { buildBetterAuthConfig } from "../src/modules/auth/auth-config";
import {
	type AuthEmailMessage,
	sendAccessInvitationEmail,
	sendPasswordResetEmail,
	withMailLane,
} from "../src/modules/auth/reset-mail";

const readAuthEmailConfig = () => ({
	authEmailFrom: "Campus Agent <auth@example.com>",
	resendApiKey: "resend_test_key",
});

function authConfig(environment: "development" | "test" | "staging" | "production") {
	return buildBetterAuthConfig({
		appName: "campus-agent-app-api",
		authShellOrigin: "https://chat.muc.wiki",
		authTurnstileSecretKey: "turnstile_secret_key",
		betterAuthSecret: "lane-secret-lane-secret-lane-secret",
		database: {} as never,
		environment,
		readAuthEmailConfig,
	} as never);
}

function recordingSender() {
	const messages: AuthEmailMessage[] = [];
	return {
		emailSender: {
			async send(message: AuthEmailMessage) {
				messages.push(message);
				return { id: `email-${messages.length}` };
			},
		},
		messages,
	};
}

describe("environment lanes in app-api auth", () => {
	it("maps only deployed environments to lanes", () => {
		expect(resolveDeploymentLane("staging")).toBe("staging");
		expect(resolveDeploymentLane("production")).toBe("production");
		expect(resolveDeploymentLane("development")).toBeUndefined();
		expect(resolveDeploymentLane("test")).toBeUndefined();
	});

	it("gives each deployed lane its own Better Auth cookie prefix", () => {
		expect(authConfig("staging").advanced).toMatchObject({ cookiePrefix: "campus-staging" });
		expect(authConfig("production").advanced).toMatchObject({
			cookiePrefix: "campus-production",
		});
		expect(authConfig("development").advanced).not.toHaveProperty("cookiePrefix");
		expect(authConfig("test").advanced).not.toHaveProperty("cookiePrefix");
	});

	it("gives each deployed lane its own federation issuer", () => {
		const jwtIssuer = (environment: Parameters<typeof authConfig>[0]) => {
			const jwtPlugin = authConfig(environment).plugins.find((plugin) => plugin.id === "jwt") as
				| { options?: { jwt?: { issuer?: string } } }
				| undefined;
			return jwtPlugin?.options?.jwt?.issuer;
		};

		expect(jwtIssuer("staging")).toBe("https://chat.muc.wiki/lanes/staging");
		expect(jwtIssuer("production")).toBe("https://chat.muc.wiki");
		expect(jwtIssuer("development")).toBeUndefined();
	});

	it("adds the issuing lane to auth email links", () => {
		expect(
			withMailLane({ lane: "staging" }, "https://chat.muc.wiki/account/register?email=a"),
		).toBe("https://chat.muc.wiki/account/register?email=a&lane=staging");
		expect(withMailLane({ lane: "production" }, "https://chat.muc.wiki/feedback")).toBe(
			"https://chat.muc.wiki/feedback?lane=prod",
		);
		expect(withMailLane({}, "https://chat.muc.wiki/feedback")).toBe(
			"https://chat.muc.wiki/feedback",
		);
	});

	it("sends staging reset and invitation links that return to staging", async () => {
		const { emailSender, messages } = recordingSender();
		const config = {
			authEmailFrom: "Campus Agent <auth@example.com>",
			authShellOrigin: "https://chat.muc.wiki",
			emailSender,
			lane: "staging" as const,
			resendApiKey: "resend_test_key",
		};

		await sendPasswordResetEmail(config, {
			token: "reset-token",
			url: "https://chat.muc.wiki/reset-password/reset-token?callbackURL=%2Faccount%2Freset-password",
			user: { email: "student@muc.edu.cn", name: "Student" },
		});
		await sendAccessInvitationEmail(config, {
			email: "guest@example.com",
			idempotencyKey: "grant-1:invitation",
			kind: "invitation",
		});

		const links = messages.map((message) => message.text.match(/https:\/\/chat\.muc\.wiki\/\S+/g));
		expect(links[0]).toContain(
			"https://chat.muc.wiki/api/auth/reset-password/reset-token?callbackURL=https%3A%2F%2Fchat.muc.wiki%2Faccount%2Freset-password&lane=staging",
		);
		expect(links[1]).toContain(
			"https://chat.muc.wiki/account/register?email=guest%40example.com&lane=staging",
		);
		for (const messageLinks of links) {
			expect(messageLinks?.every((link) => link.includes("lane=staging"))).toBe(true);
		}
	});
});
