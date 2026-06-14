import { fireEvent, screen } from "@testing-library/react";
import type { Mock } from "vitest";

interface MatchMediaMock extends Mock<(query: string) => MediaQueryList> {}

export function mockMapWorkspaceWidth(matches: boolean, createMock: () => Mock) {
	window.matchMedia = createMock().mockImplementation((query: string) => ({
		addEventListener: createMock(),
		addListener: createMock(),
		dispatchEvent: createMock().mockReturnValue(false),
		matches: query === "(min-width: 960px)" ? matches : false,
		media: query,
		onchange: null,
		removeEventListener: createMock(),
		removeListener: createMock(),
	})) as MatchMediaMock;
}

export function installMapStyleTokens() {
	document.documentElement.style.setProperty("--alpha-blue-8", "rgba(11, 48, 143, 0.08)");
	document.documentElement.style.setProperty("--alpha-blue-12", "rgba(11, 48, 143, 0.12)");
	document.documentElement.style.setProperty("--muc-red", "#a20000");
	document.documentElement.style.setProperty("--neutral-0", "#ffffff");
	document.documentElement.style.setProperty("--neutral-100", "#f4f5f7");
	document.documentElement.style.setProperty("--neutral-150", "#eef0f3");
	document.documentElement.style.setProperty("--neutral-300", "#d0d5dd");
	document.documentElement.style.setProperty("--neutral-800", "#1d2939");
	document.documentElement.style.setProperty("--map-style-background", "#edf1f4");
	document.documentElement.style.setProperty("--map-style-boundary", "#a20000");
	document.documentElement.style.setProperty("--map-style-building-fill", "#f9fafb");
	document.documentElement.style.setProperty("--map-style-building-outline", "#98a2b3");
	document.documentElement.style.setProperty("--map-style-green-fill", "#d9eadf");
	document.documentElement.style.setProperty("--map-style-label", "#101828");
	document.documentElement.style.setProperty("--map-style-road-fill", "#d6dce3");
	document.documentElement.style.setProperty(
		"--map-style-selection-fill",
		"rgba(26, 115, 232, 0.14)",
	);
	document.documentElement.style.setProperty(
		"--map-style-selection-halo",
		"rgba(255, 255, 255, 0.92)",
	);
	document.documentElement.style.setProperty("--map-style-selection-outline", "#1a73e8");
	document.documentElement.style.setProperty("--map-style-sport-fill", "#dce8f8");
}

export async function expandMapResults() {
	if (screen.queryByRole("button", { name: "收起地点结果" })) {
		return;
	}
	const trigger = await screen.findByRole("button", { name: "展开地点结果" });
	fireEvent.click(trigger);
}
