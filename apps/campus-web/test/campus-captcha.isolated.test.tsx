import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@marsidev/react-turnstile", () => ({
	Turnstile: ({ options }: { options?: { language?: string } }) => (
		<fieldset aria-label="安全验证" data-language={options?.language} />
	),
}));

vi.mock("@/platform/auth/turnstile-runtime-config", () => ({
	readTurnstileRuntimeConfig: () => ({
		turnstileAppearance: "interaction-only",
		turnstileExecution: "render",
		turnstileSiteKey: "test-site-key",
	}),
}));

import { CampusCaptcha } from "../src/components/auth/campus-captcha";

describe("campus captcha", () => {
	it("uses the supported Turnstile locale", () => {
		render(<CampusCaptcha />);

		expect(screen.getByLabelText("安全验证")).toHaveAttribute("data-language", "zh-cn");
	});
});
