import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountDeletionPanel } from "../src/features/account-lifecycle/account-deletion-panel";

describe("account deletion", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("requires the current password and reports asynchronous cleanup accurately", async () => {
		const onAccepted = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ requestId: "acctdel_01", status: "deleting" }), {
				headers: { "content-type": "application/json" },
				status: 202,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const user = userEvent.setup();
		render(<AccountDeletionPanel onAccepted={onAccepted} />);

		await user.click(screen.getByRole("button", { name: "注销账号" }));
		const submit = screen.getByRole("button", { name: "确认注销" });
		expect(submit).toBeDisabled();
		await user.type(screen.getByLabelText("当前密码"), "Password!2026");
		await user.click(submit);

		expect(onAccepted).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/account/delete",
			expect.objectContaining({
				body: JSON.stringify({ password: "Password!2026" }),
				method: "POST",
			}),
		);
	});

	it("keeps the confirmation dialog open when password verification fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							code: "REAUTHENTICATION_REQUIRED",
							message: "Current password is invalid.",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 401 },
				),
			),
		);
		const user = userEvent.setup();
		render(<AccountDeletionPanel />);

		await user.click(screen.getByRole("button", { name: "注销账号" }));
		await user.type(screen.getByLabelText("当前密码"), "wrong-password");
		await user.click(screen.getByRole("button", { name: "确认注销" }));

		expect(await screen.findByText("当前密码不正确。")).toBeInTheDocument();
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
	});
});
