import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => {
	cleanup();
});
