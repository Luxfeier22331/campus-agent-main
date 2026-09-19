import "./setup";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

if (typeof CSS !== "undefined" && typeof CSS.supports !== "function") {
	Object.defineProperty(CSS, "supports", { configurable: true, value: () => false });
}

beforeEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: vi.fn().mockResolvedValue(undefined) },
	});
	vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(cleanup);
