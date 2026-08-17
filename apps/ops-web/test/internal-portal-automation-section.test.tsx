import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app.tsx";

const credentials = [
	{
		createdAt: "2026-08-02T01:00:00.000Z",
		credentialId: "11111111-1111-4111-8111-111111111111",
		lastAttemptAt: "2026-08-02T01:00:00.000Z",
		lastOutcome: "valid",
		lastSuccessfulAt: "2026-08-02T01:00:00.000Z",
		name: "第一条凭据",
		updatedAt: "2026-08-02T01:00:00.000Z",
		version: 1,
	},
	{
		createdAt: "2026-08-02T01:02:00.000Z",
		credentialId: "22222222-2222-4222-8222-222222222222",
		lastAttemptAt: "2026-08-02T02:00:00.000Z",
		lastOutcome: "credential_rejected",
		lastSuccessfulAt: "2026-08-02T01:30:00.000Z",
		name: "第二条凭据",
		updatedAt: "2026-08-02T01:02:00.000Z",
		version: 1,
	},
];
const automationToken = {
	createdAt: "2026-08-02T03:00:00.000Z",
	name: "开发同步程序",
	revokedAt: null,
	tokenId: "33333333-3333-4333-8333-333333333333",
};

describe("internal portal automation section", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("shows the automation endpoint and keeps revealed token plaintext in the dialog", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (
				url.includes("/automation-tokens") &&
				url.endsWith("/reveal") &&
				init?.method === "POST"
			) {
				return Response.json({ token: { ...automationToken, tokenValue: "ops_plaintext" } });
			}
			if (url.includes("/automation-tokens")) {
				return Response.json({
					endpoint: "https://ops-api.example.test",
					tokens: [automationToken],
				});
			}
			return Response.json({ credentials });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<OpsWebApp initialPath="/internal-portal" />);

		expect(await screen.findByDisplayValue("https://ops-api.example.test")).toBeInTheDocument();
		expect((await screen.findAllByText("开发同步程序")).length).toBeGreaterThan(0);
		expect(screen.queryByDisplayValue("ops_plaintext")).not.toBeInTheDocument();

		fireEvent.click(screen.getAllByRole("button", { name: "显示 token" })[0] as HTMLElement);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "显示 token" }));
		expect(await within(dialog).findByDisplayValue("ops_plaintext")).toBeInTheDocument();

		fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0] as HTMLElement);
		await waitFor(() =>
			expect(screen.queryByDisplayValue("ops_plaintext")).not.toBeInTheDocument(),
		);
	});
});
