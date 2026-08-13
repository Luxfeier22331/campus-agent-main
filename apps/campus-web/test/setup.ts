import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

class TestResizeObserver {
	disconnect() {
		return;
	}
	observe() {
		return;
	}
	unobserve() {
		return;
	}
}

globalThis.ResizeObserver ??= TestResizeObserver;
if (typeof window !== "undefined") {
	window.requestAnimationFrame ??= (callback: FrameRequestCallback) =>
		window.setTimeout(() => callback(performance.now()), 16);
	window.cancelAnimationFrame ??= (handle: number) => window.clearTimeout(handle);
	window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
		addEventListener: vi.fn(),
		addListener: vi.fn(),
		dispatchEvent: vi.fn().mockReturnValue(false),
		matches: false,
		media: query,
		onchange: null,
		removeEventListener: vi.fn(),
		removeListener: vi.fn(),
	}));
}
if (typeof Element !== "undefined") {
	Element.prototype.scrollTo ??= function scrollTo() {
		return;
	};
	Element.prototype.scrollIntoView ??= function scrollIntoView() {
		return;
	};
}

afterEach(() => {
	cleanup();
});
