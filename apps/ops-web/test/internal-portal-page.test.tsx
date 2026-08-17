import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app.tsx";

describe("internal portal page", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("composes credential and automation sections", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) =>
				String(input).includes("/automation-tokens")
					? Response.json({ endpoint: "https://ops-api.example.test", tokens: [] })
					: Response.json({ credentials: [] }),
			),
		);

		render(<OpsWebApp initialPath="/internal-portal" />);

		await screen.findByText("尚无内部门户凭据。");
		await screen.findByDisplayValue("https://ops-api.example.test");
		expect(screen.getByRole("heading", { name: "内部门户凭据" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "开发者自动化访问" })).toBeInTheDocument();
	});
});
