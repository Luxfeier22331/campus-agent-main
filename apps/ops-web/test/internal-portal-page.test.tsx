import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

describe("internal portal authentication page", () => {
	it("shows operational timestamps without displaying the credential", async () => {
		render(<OpsWebApp initialPath="/internal-portal" />);

		expect(await screen.findByRole("heading", { name: "内部门户" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "内部门户" })).toHaveAttribute("aria-current", "page");
		expect(await screen.findByText("最近一次成功使用")).toBeInTheDocument();
		expect(screen.getByText("已有成功记录")).toBeInTheDocument();
		expect(screen.getByLabelText("新的 SSO_TGC")).toHaveAttribute("type", "password");
		expect(document.body).not.toHaveTextContent("TGT-");
	});

	it("replaces a raw TGC, clears the input, and waits for the scheduled check", async () => {
		render(<OpsWebApp initialPath="/internal-portal" />);
		const input = await screen.findByLabelText("新的 SSO_TGC");
		fireEvent.change(input, { target: { value: "TGT-replacement" } });
		fireEvent.click(screen.getByRole("button", { name: "替换" }));

		expect(await screen.findByText("TGC 已替换，等待下一次定期认证检查。")).toBeInTheDocument();
		await waitFor(() => expect(input).toHaveValue(""));
		expect(screen.getByText("尚无成功记录")).toBeInTheDocument();
	});

	it("rejects a complete Cookie string before sending it", async () => {
		render(<OpsWebApp initialPath="/internal-portal" />);
		const input = await screen.findByLabelText("新的 SSO_TGC");
		fireEvent.change(input, { target: { value: "SSO_TGC=TGT-value; Path=/" } });
		fireEvent.click(screen.getByRole("button", { name: "替换" }));

		expect(
			await screen.findByText("请输入原始 SSO_TGC 值，不要包含 Cookie 名称或其他 Cookie 字段。"),
		).toBeInTheDocument();
	});
});
