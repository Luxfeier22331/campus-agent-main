import { ThemeProvider } from "@campus-agent/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STYLE_DEV_STORIES } from "../src/style-dev/catalog";
import { ACCOUNT_ENTRIES } from "../src/style-dev/examples/account";
import { DOCS_ENTRIES } from "../src/style-dev/examples/docs";

describe("style-dev examples", () => {
	it("mounts every public variant without starting a network request", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("unexpected request"));

		for (const story of STYLE_DEV_STORIES) {
			for (const variant of story.variants) {
				const view = render(
					<ThemeProvider storageKey="campus-agent.style-dev.test-theme">
						{variant.render()}
					</ThemeProvider>,
				);
				await act(async () => {
					await Promise.resolve();
				});
				expect(fetchSpy, `${story.id}/${variant.id}`).not.toHaveBeenCalled();
				view.unmount();
			}
		}
		vi.restoreAllMocks();
	});

	it("keeps the authenticated account entry inside the style-dev router", async () => {
		const user = userEvent.setup();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const entry = ACCOUNT_ENTRIES.find((story) => story.id === "style-dev-account-entry");
		if (!entry) {
			throw new Error("style-dev account entry is missing");
		}

		const view = render(
			<ThemeProvider storageKey="campus-agent.style-dev.account-test-theme">
				{entry.variants[0]?.render()}
			</ThemeProvider>,
		);

		await user.click(await screen.findByRole("button", { name: /校园用户/u }));
		await user.click(await screen.findByRole("menuitem", { name: "账号设置" }));
		await waitFor(() => {
			const output = [...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
			expect(output).not.toContain("useRouter must be used inside");
			expect(output).not.toContain("Cannot read properties of null");
		});

		view.unmount();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("keeps document metadata out of the docs page preview", async () => {
		const story = DOCS_ENTRIES.find((candidate) => candidate.id === "style-dev-docs-page");
		if (!story) {
			throw new Error("style-dev docs page entry is missing");
		}

		document.head.innerHTML = "<title>Campus UI</title>";
		const view = render(
			<ThemeProvider storageKey="campus-agent.style-dev.docs-test-theme">
				{story.variants.find((variant) => variant.id === "article")?.render()}
			</ThemeProvider>,
		);

		await act(async () => {
			await Promise.resolve();
		});
		expect(document.title).toBe("Campus UI");
		expect(document.head.querySelector('meta[name="description"]')).toBeNull();
		expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();

		view.unmount();
	});
});
