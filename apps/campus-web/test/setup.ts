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
