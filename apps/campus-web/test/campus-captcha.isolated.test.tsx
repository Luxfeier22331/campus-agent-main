import { render, screen } from "@testing-library/react";
import { createRef, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const turnstile = vi.hoisted(() => ({
	execute: vi.fn(),
	getResponse: vi.fn<() => string | undefined>(),
	getResponsePromise: vi.fn<(timeout?: number) => Promise<string>>(),
	reset: vi.fn(),
}));

const config = vi.hoisted(() => ({
	turnstileAppearance: "interaction-only",
	turnstileExecution: "render",
	turnstileSiteKey: "test-site-key" as string | null,
}));

vi.mock("@marsidev/react-turnstile", () => ({
	Turnstile: ({
		options,
		ref,
	}: {
		options?: { language?: string };
		ref: Ref<typeof turnstile>;
	}) => {
		useImperativeHandle(ref, () => turnstile, []);
		return <fieldset aria-label="安全验证" data-language={options?.language} />;
	},
}));

vi.mock("@/platform/auth/turnstile-runtime-config", () => ({
	readTurnstileRuntimeConfig: () => config,
}));

import { CampusCaptcha, type CampusCaptchaHandle } from "../src/components/auth/campus-captcha";

describe("campus captcha", () => {
	beforeEach(() => {
		config.turnstileExecution = "render";
		config.turnstileSiteKey = "test-site-key";
		for (const mock of Object.values(turnstile)) {
			mock.mockReset();
		}
	});

	it("uses the supported Turnstile locale", () => {
		render(<CampusCaptcha />);

		expect(screen.getByLabelText("安全验证")).toHaveAttribute("data-language", "zh-cn");
	});

	it("returns an existing token without executing or waiting again", async () => {
		turnstile.getResponse.mockReturnValue("ready-token");
		const ref = createRef<CampusCaptchaHandle>();
		render(<CampusCaptcha ref={ref} />);

		await expect(ref.current?.getToken()).resolves.toBe("ready-token");
		expect(turnstile.execute).not.toHaveBeenCalled();
		expect(turnstile.getResponsePromise).not.toHaveBeenCalled();
	});

	it.each(["render", "execute"])(
		"waits for an asynchronous token in %s mode",
		async (execution) => {
			config.turnstileExecution = execution;
			let resolveToken!: (token: string) => void;
			turnstile.getResponsePromise.mockReturnValue(
				new Promise<string>((resolve) => {
					resolveToken = resolve;
				}),
			);
			const ref = createRef<CampusCaptchaHandle>();
			render(<CampusCaptcha ref={ref} />);

			const token = ref.current?.getToken();
			const settled = vi.fn();
			void token?.then(settled);
			await Promise.resolve();

			expect(settled).not.toHaveBeenCalled();
			expect(turnstile.getResponsePromise).toHaveBeenCalledWith(30_000);
			if (execution === "execute") {
				expect(turnstile.execute).toHaveBeenCalledOnce();
				expect(turnstile.execute.mock.invocationCallOrder[0]).toBeLessThan(
					turnstile.getResponsePromise.mock.invocationCallOrder[0]!,
				);
			} else {
				expect(turnstile.execute).not.toHaveBeenCalled();
			}

			resolveToken("async-token");
			await expect(token).resolves.toBe("async-token");
		},
	);

	it.each(["Timeout", "Failed to get response"])("returns no token on %s", async (message) => {
		turnstile.getResponsePromise.mockRejectedValue(new Error(message));
		const ref = createRef<CampusCaptchaHandle>();
		render(<CampusCaptcha ref={ref} />);

		await expect(ref.current?.getToken()).resolves.toBeUndefined();
	});

	it("skips verification without a site key", async () => {
		config.turnstileSiteKey = null;
		const ref = createRef<CampusCaptchaHandle>();
		render(<CampusCaptcha ref={ref} />);

		expect(ref.current?.enabled).toBe(false);
		await expect(ref.current?.getToken()).resolves.toBeUndefined();
		expect(screen.queryByLabelText("安全验证")).not.toBeInTheDocument();
		expect(turnstile.getResponsePromise).not.toHaveBeenCalled();
	});
});
