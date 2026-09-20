import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Mock, vi } from "vitest";

interface MatchMediaMock extends Mock<(query: string) => MediaQueryList> {}

export function mockMapWorkspaceWidth(matches: boolean, createMock: () => Mock) {
	vi.stubGlobal("innerWidth", matches ? 1024 : 390);
	vi.stubGlobal(
		"matchMedia",
		createMock().mockImplementation((query: string) => ({
			addEventListener: createMock(),
			addListener: createMock(),
			dispatchEvent: createMock().mockReturnValue(false),
			matches:
				query === "(min-width: 960px)"
					? matches
					: query === "(max-width: 767px)"
						? !matches
						: false,
			media: query,
			onchange: null,
			removeEventListener: createMock(),
			removeListener: createMock(),
		})) as MatchMediaMock,
	);
}

export function installMapStyleTokens() {
	document.documentElement.style.setProperty("--neutral-0", "#ffffff");
	document.documentElement.style.setProperty("--neutral-100", "#f5f5f7");
	document.documentElement.style.setProperty("--neutral-150", "#efeff2");
	document.documentElement.style.setProperty("--neutral-300", "#d1d1d6");
	document.documentElement.style.setProperty("--neutral-800", "#2c2c2e");
	document.documentElement.style.setProperty("--map-style-background", "#efeff2");
	document.documentElement.style.setProperty("--map-style-boundary", "#262627");
	document.documentElement.style.setProperty("--map-style-building-fill", "#fafafb");
	document.documentElement.style.setProperty("--map-style-building-outline", "#8e8e93");
	document.documentElement.style.setProperty("--map-style-green-fill", "#dfeee4");
	document.documentElement.style.setProperty("--map-style-label", "#1c1c1e");
	document.documentElement.style.setProperty("--map-style-road-fill", "#d1d1d6");
	document.documentElement.style.setProperty("--map-style-selection-fill", "#e8e8eb");
	document.documentElement.style.setProperty("--map-style-selection-halo", "#ffffff");
	document.documentElement.style.setProperty("--map-style-selection-outline", "#6f6f76");
	document.documentElement.style.setProperty("--map-style-sport-fill", "#e1e8f5");
}

export async function expandMapResults() {
	if (screen.queryByRole("button", { name: "收起地点结果" })) {
		return;
	}
	const trigger = await screen.findByRole("button", { name: "展开地点结果" });
	await userEvent.setup().click(trigger);
}
