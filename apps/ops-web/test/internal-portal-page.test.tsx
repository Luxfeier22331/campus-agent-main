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
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessfulAt: null,
		name: "第二条凭据",
		updatedAt: "2026-08-02T01:02:00.000Z",
		version: 1,
	},
];

describe("internal portal credentials page", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("shows multiple credentials and keeps revealed plaintext in the dialog lifecycle", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).endsWith("/reveal") && init?.method === "POST") {
				return Response.json({
					credentialId: credentials[0]?.credentialId,
					ssoTgc: "TGT-plaintext",
					version: 1,
				});
			}
			return Response.json({ credentials });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<OpsWebApp initialPath="/internal-portal" />);

		expect(await screen.findByRole("heading", { name: "内部门户凭据" })).toBeInTheDocument();
		expect((await screen.findAllByText("第一条凭据")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("第二条凭据")).length).toBeGreaterThan(0);
		expect(screen.queryByDisplayValue("TGT-plaintext")).not.toBeInTheDocument();

		fireEvent.click(screen.getAllByRole("button", { name: "显示明文" })[0] as HTMLElement);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "显示明文" }));
		expect(await within(dialog).findByDisplayValue("TGT-plaintext")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/reveal$/u),
			expect.objectContaining({ method: "POST" }),
		);

		fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0] as HTMLElement);
		await waitFor(() =>
			expect(screen.queryByDisplayValue("TGT-plaintext")).not.toBeInTheDocument(),
		);
	});
});
