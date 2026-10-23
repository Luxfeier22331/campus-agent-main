import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProductBrandLink } from "../src/components/navigation/product-navigation";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "../src/platform/runtime/config";

function injectRuntimeConfig(deploymentLane: string | null) {
	const script = document.createElement("script");
	script.id = CAMPUS_RUNTIME_CONFIG_SCRIPT_ID;
	script.type = "application/json";
	script.textContent = JSON.stringify({
		accountUrl: "https://chat.muc.wiki/account",
		deploymentLane,
		loginUrl: "https://chat.muc.wiki/account/login",
	});
	document.head.appendChild(script);
}

describe("product brand lane badge", () => {
	afterEach(() => {
		document.getElementById(CAMPUS_RUNTIME_CONFIG_SCRIPT_ID)?.remove();
	});

	it("marks the staging lane as the preview build", () => {
		injectRuntimeConfig("staging");
		render(<ProductBrandLink />);

		expect(screen.getByText("体验版")).toBeTruthy();
	});

	it.each([["production"], [null]])("shows no badge for lane %s", (lane) => {
		injectRuntimeConfig(lane);
		render(<ProductBrandLink />);

		expect(screen.queryByText("体验版")).toBeNull();
	});

	it("shows no badge on pages without injected runtime config", () => {
		render(<ProductBrandLink />);

		expect(screen.queryByText("体验版")).toBeNull();
	});
});
