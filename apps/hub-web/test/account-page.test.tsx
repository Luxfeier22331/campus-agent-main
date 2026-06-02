import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AccountOverviewPanel } from "../src/routes/account-page";
import type { AccountOverview } from "../src/routes/account-session";

const overview: AccountOverview = {
	account: {
		accountId: "user_01HQ",
		displayName: "Jane Doe",
		email: "jane@muc.edu.cn",
		status: "active",
	},
	session: {
		credentialRuntime: "better_auth",
		expiresAt: "2026-03-29T07:00:00.000Z",
		sessionId: "sess_01HQ",
		state: "authenticated",
	},
	identity: {
		claimsVersion: "identity-claims-v1",
		principalId: "user_01HQ",
		principalType: "campus_member",
		verificationStatus: "unverified",
	},
	access: {
		availableApps: ["chat", "docs", "account"],
		entitlementGroups: ["campus_members"],
		permissions: {
			chat: true,
			operator: false,
		},
		restrictedSurfacesReady: false,
	},
	preferences: {
		profileMemoryEnabled: true,
		profileMemoryItemCount: 0,
	},
	federation: {
		connectedClients: [],
		enabled: false,
	},
};

describe("hub account overview panel", () => {
	it("renders identity, access, preferences, and federation account center sections", () => {
		const html = renderToStaticMarkup(
			<AccountOverviewPanel
				isSigningOut={false}
				onProfileMemoryChange={vi.fn()}
				onSignOut={vi.fn()}
				overview={overview}
			/>,
		);

		expect(html).toContain("jane@muc.edu.cn");
		expect(html).toContain("校园身份");
		expect(html).toContain("可用应用");
		expect(html).toContain("资料记忆");
		expect(html).toContain("关闭资料记忆");
		expect(html).toContain("MUC Wiki 登录联邦");
		expect(html).toContain("campus_member");
		expect(html).toContain("未验证");
	});
});
