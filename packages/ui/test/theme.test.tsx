import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeModeControl } from "../src/theme-mode-control";
import { ThemeModeMenu } from "../src/theme-mode-menu";
import { ThemeProvider } from "../src/theme-provider";

let prefersDark = false;
let prefersReducedMotion = false;
let mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-theme");
	document.documentElement.removeAttribute("data-theme-transitioning");
	document.documentElement.style.removeProperty("color-scheme");
	Reflect.deleteProperty(document, "startViewTransition");
	mediaListeners = new Set();
});

beforeEach(() => {
	prefersDark = false;
	prefersReducedMotion = false;
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: query === "(prefers-reduced-motion: reduce)" ? prefersReducedMotion : prefersDark,
		media: query,
		addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
			mediaListeners.add(listener);
		},
		removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
			mediaListeners.delete(listener);
		},
	})) as unknown as typeof window.matchMedia;
});

describe("theme controls", () => {
	it("persists a manual mode and applies its semantic root attribute", async () => {
		const user = userEvent.setup();
		render(
			<ThemeProvider>
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("radio", { name: "深色" }));
		await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
		expect(window.localStorage.getItem("campus-agent.theme")).toBe("dark");
		expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
	});

	it("hydrates a stored mode after the deterministic first render", async () => {
		const viewTransitions = installViewTransitionMock();
		window.localStorage.setItem("campus-agent.theme", "dark");
		render(
			<ThemeProvider>
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await waitFor(() => {
			expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
			expect(document.documentElement).toHaveAttribute("data-theme", "dark");
		});
		expect(viewTransitions.start).not.toHaveBeenCalled();
	});

	it("tracks operating-system preference changes while in system mode", async () => {
		prefersDark = true;
		render(
			<ThemeProvider>
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
		prefersDark = false;
		for (const listener of mediaListeners) {
			listener({ matches: false } as MediaQueryListEvent);
		}

		await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
		expect(screen.getByRole("radio", { name: "跟随系统" })).toBeChecked();
	});

	it("ignores invalid stored values and exposes the three mode choices", () => {
		window.localStorage.setItem("campus-agent.theme", "invalid");
		render(
			<ThemeProvider>
				<ThemeModeControl />
			</ThemeProvider>,
		);

		expect(screen.getByRole("radiogroup", { name: "外观" })).toBeInTheDocument();
		expect(screen.getByRole("radiogroup", { name: "外观" })).toHaveClass("select-none");
		expect(screen.getByRole("radio", { name: "跟随系统" })).toBeChecked();
		expect(screen.getAllByRole("radio")).toHaveLength(3);
	});

	it("renders a safe system default without a provider", () => {
		render(<ThemeModeControl />);

		expect(screen.getByRole("radiogroup", { name: "外观" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "跟随系统" })).toBeChecked();
	});

	it("supports an external accessible label without adding a duplicate label", () => {
		render(
			<>
				<p id="external-theme-label">外观</p>
				<ThemeModeControl aria-labelledby="external-theme-label" label={null} />
			</>,
		);

		expect(screen.getByRole("radiogroup", { name: "外观" })).toHaveAttribute(
			"aria-labelledby",
			"external-theme-label",
		);
		expect(screen.getByRole("radiogroup", { name: "外观" })).not.toHaveAttribute("aria-label");
	});

	it("crossfades a manual change and clears the transition marker when it finishes", async () => {
		const user = userEvent.setup();
		const viewTransitions = installViewTransitionMock();
		render(
			<ThemeProvider defaultMode="light">
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("radio", { name: "深色" }));

		expect(viewTransitions.start).toHaveBeenCalledTimes(1);
		expect(document.documentElement).toHaveAttribute("data-theme", "dark");
		expect(document.documentElement).toHaveAttribute("data-theme-transitioning", "true");
		viewTransitions.transitions[0]?.finish();
		await waitFor(() =>
			expect(document.documentElement).not.toHaveAttribute("data-theme-transitioning"),
		);
	});

	it("switches instantly for reduced motion and when the resolved theme is unchanged", async () => {
		const user = userEvent.setup();
		const viewTransitions = installViewTransitionMock();
		prefersReducedMotion = true;
		render(
			<ThemeProvider>
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("radio", { name: "深色" }));
		expect(viewTransitions.start).not.toHaveBeenCalled();
		expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();

		prefersReducedMotion = false;
		await user.click(screen.getByRole("radio", { name: "浅色" }));
		expect(viewTransitions.start).toHaveBeenCalledTimes(1);
	});

	it("skips an active transition before starting the latest theme choice", async () => {
		const user = userEvent.setup();
		const viewTransitions = installViewTransitionMock();
		render(
			<ThemeProvider defaultMode="light">
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("radio", { name: "深色" }));
		await user.click(screen.getByRole("radio", { name: "浅色" }));

		expect(viewTransitions.start).toHaveBeenCalledTimes(2);
		expect(viewTransitions.transitions[0]?.skip).toHaveBeenCalledTimes(1);
		expect(document.documentElement).toHaveAttribute("data-theme", "light");
		expect(document.documentElement).toHaveAttribute("data-theme-transitioning", "true");
		viewTransitions.transitions[1]?.finish();
		await waitFor(() =>
			expect(document.documentElement).not.toHaveAttribute("data-theme-transitioning"),
		);
	});

	it("keeps the transition active when returning to system mode", async () => {
		const user = userEvent.setup();
		const viewTransitions = installViewTransitionMock();
		render(
			<ThemeProvider defaultMode="dark">
				<ThemeModeControl />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("radio", { name: "跟随系统" }));

		expect(viewTransitions.start).toHaveBeenCalledTimes(1);
		expect(viewTransitions.transitions[0]?.skip).not.toHaveBeenCalled();
		expect(document.documentElement).toHaveAttribute("data-theme-transitioning", "true");
	});

	it("ignores a skipped transition callback that runs after a newer choice", () => {
		const viewTransitions = installDeferredViewTransitionMock();
		render(
			<ThemeProvider defaultMode="light">
				<ThemeModeControl />
			</ThemeProvider>,
		);

		fireEvent.click(screen.getByRole("radio", { name: "深色" }));
		fireEvent.click(screen.getByRole("radio", { name: "浅色" }));
		viewTransitions.transitions[0]?.update();

		expect(viewTransitions.transitions[0]?.skip).toHaveBeenCalledTimes(1);
		expect(document.documentElement).toHaveAttribute("data-theme", "light");
		expect(screen.getByRole("radio", { name: "浅色" })).toBeChecked();
	});

	it("uses a compact radio menu with a current-mode label and focus recovery", async () => {
		const user = userEvent.setup();
		render(
			<ThemeProvider>
				<ThemeModeMenu />
			</ThemeProvider>,
		);

		const trigger = screen.getByRole("button", { name: "外观，当前跟随系统" });
		await user.hover(trigger);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("外观，当前跟随系统");
		await user.unhover(trigger);
		await user.click(trigger);
		const menu = screen.getByRole("menu", { name: "外观" });
		expect(menu).toBeInTheDocument();
		expect(menu).toHaveClass("select-none");
		expect(screen.getByRole("menuitemradio", { name: "跟随系统" })).toBeChecked();

		await user.click(screen.getByRole("menuitemradio", { name: "深色" }));
		await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
		expect(screen.queryByRole("menu", { name: "外观" })).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
		expect(trigger).toHaveAccessibleName("外观，当前深色");
	});

	describe("cross-subdomain cookie sync", () => {
		beforeEach(() => {
			window.localStorage.clear();
			// biome-ignore lint/suspicious/noDocumentCookie: test fixture controls the shared theme cookie directly.
			document.cookie = "campus-agent.theme=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
		});

		it("writes the theme to a shared cookie when syncCookie is enabled", async () => {
			const user = userEvent.setup();
			render(
				<ThemeProvider syncCookie>
					<ThemeModeControl />
				</ThemeProvider>,
			);

			await user.click(screen.getByRole("radio", { name: "深色" }));
			await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
			expect(document.cookie).toContain("campus-agent.theme=dark");
		});

		it("hydrates from the shared cookie when localStorage is empty", async () => {
			// biome-ignore lint/suspicious/noDocumentCookie: test fixture controls the shared theme cookie directly.
			document.cookie = "campus-agent.theme=dark; path=/";
			render(
				<ThemeProvider syncCookie>
					<ThemeModeControl />
				</ThemeProvider>,
			);

			await waitFor(() => {
				expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
				expect(document.documentElement).toHaveAttribute("data-theme", "dark");
			});
		});

		it("prefers the shared cookie over localStorage when both are present", async () => {
			window.localStorage.setItem("campus-agent.theme", "light");
			// biome-ignore lint/suspicious/noDocumentCookie: test fixture controls the shared theme cookie directly.
			document.cookie = "campus-agent.theme=dark; path=/";
			render(
				<ThemeProvider syncCookie>
					<ThemeModeControl />
				</ThemeProvider>,
			);

			await waitFor(() => {
				expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
				expect(document.documentElement).toHaveAttribute("data-theme", "dark");
			});
		});

		it("does not touch cookies when syncCookie is disabled", async () => {
			const user = userEvent.setup();
			render(
				<ThemeProvider>
					<ThemeModeControl />
				</ThemeProvider>,
			);

			await user.click(screen.getByRole("radio", { name: "深色" }));
			await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
			expect(document.cookie).not.toContain("campus-agent.theme=");
		});
	});
});

function installViewTransitionMock() {
	const transitions: Array<{
		finish: () => void;
		skip: ReturnType<typeof vi.fn>;
	}> = [];
	const start = vi.fn((update: () => void) => {
		let finish: () => void = () => undefined;
		const finished = new Promise<void>((resolve) => {
			finish = () => resolve();
		});
		const skip = vi.fn(() => finish());
		update();
		transitions.push({ finish, skip });
		return {
			finished,
			ready: Promise.resolve(),
			skipTransition: skip,
			updateCallbackDone: Promise.resolve(),
		};
	});
	Object.defineProperty(document, "startViewTransition", {
		configurable: true,
		value: start,
	});
	return { start, transitions };
}

function installDeferredViewTransitionMock() {
	const transitions: Array<{
		skip: ReturnType<typeof vi.fn>;
		update: () => void;
	}> = [];
	const start = vi.fn((update: () => void) => {
		let finish: () => void = () => undefined;
		const finished = new Promise<void>((resolve) => {
			finish = () => resolve();
		});
		const skip = vi.fn(() => finish());
		transitions.push({ skip, update });
		return {
			finished,
			ready: Promise.resolve(),
			skipTransition: skip,
			updateCallbackDone: Promise.resolve(),
		};
	});
	Object.defineProperty(document, "startViewTransition", {
		configurable: true,
		value: start,
	});
	return { start, transitions };
}
