import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/tokens.css", "utf8");
const light = parseBlock(source.match(/^:root\s*\{([\s\S]*?)\n\}/u)?.[1]);
const explicitDark = parseBlock(
	source.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/u)?.[1],
);
const systemDark = parseBlock(
	source.match(
		/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \{([\s\S]*?)\n\t\}\n\}/u,
	)?.[1],
);

describe("shared color tokens", () => {
	it("keeps the brand primitives fixed and removes ambiguous legacy aliases", () => {
		expect(light.get("--muc-red")).toBe("#a20000");
		expect(light.get("--muc-caisson-blue")).toBe("#0b308f");
		expect(light.get("--muc-pine-green")).toBe("#00703e");
		expect(light.get("--muc-ginkgo-yellow")).toBe("#eeb736");

		for (const token of [
			"--sys-brand-interactive",
			"--sys-brand-interactive-subtle",
			"--sys-border-focus",
			"--alpha-blue-8",
			"--alpha-blue-12",
			"--alpha-red-8",
			"--button-primary-bg",
			"--button-primary-text",
			"--input-bg",
		]) {
			expect(source).not.toContain(`${token}:`);
		}
	});

	it("keeps explicit and system dark modes on the same color contract", () => {
		expect(Object.fromEntries(systemDark)).toEqual(Object.fromEntries(explicitDark));
	});

	it.each([
		["light strong text", light, "--sys-text-strong", "--sys-surface-default"],
		["light default text", light, "--sys-text-default", "--sys-surface-default"],
		["light muted text", light, "--sys-text-muted", "--sys-bg-canvas"],
		["light subtle text", light, "--sys-text-subtle", "--sys-bg-canvas"],
		["light link", light, "--sys-text-link", "--sys-surface-default"],
		["light selected text", light, "--sys-text-selected", "--sys-surface-selected"],
		["light selected hover text", light, "--sys-text-selected", "--sys-surface-selected-hover"],
		["light selected pressed text", light, "--sys-text-selected", "--sys-surface-selected-pressed"],
		["light primary", light, "--sys-tint-foreground", "--sys-tint"],
		["light primary hover", light, "--sys-tint-foreground", "--sys-tint-hover"],
		["light primary pressed", light, "--sys-tint-foreground", "--sys-tint-pressed"],
		["light info", light, "--sys-status-info", "--sys-status-info-subtle"],
		["light success", light, "--sys-status-success", "--sys-status-success-subtle"],
		["light warning", light, "--sys-status-warning", "--sys-status-warning-subtle"],
		["light danger", light, "--sys-status-danger", "--sys-status-danger-subtle"],
		["dark strong text", explicitDark, "--sys-text-strong", "--sys-surface-default"],
		["dark default text", explicitDark, "--sys-text-default", "--sys-surface-default"],
		["dark muted text", explicitDark, "--sys-text-muted", "--sys-surface-default"],
		["dark subtle text", explicitDark, "--sys-text-subtle", "--sys-surface-default"],
		["dark link", explicitDark, "--sys-text-link", "--sys-surface-default"],
		["dark selected text", explicitDark, "--sys-text-selected", "--sys-surface-selected"],
		[
			"dark selected pressed text",
			explicitDark,
			"--sys-text-selected",
			"--sys-surface-selected-pressed",
		],
		["dark primary", explicitDark, "--sys-tint-foreground", "--sys-tint"],
		["dark primary hover", explicitDark, "--sys-tint-foreground", "--sys-tint-hover"],
		["dark primary pressed", explicitDark, "--sys-tint-foreground", "--sys-tint-pressed"],
		["dark info", explicitDark, "--sys-status-info", "--sys-status-info-subtle"],
		["dark success", explicitDark, "--sys-status-success", "--sys-status-success-subtle"],
		["dark warning", explicitDark, "--sys-status-warning", "--sys-status-warning-subtle"],
		["dark danger", explicitDark, "--sys-status-danger", "--sys-status-danger-subtle"],
	])("keeps %s at WCAG AA text contrast", (_name, tokens, foreground, background) => {
		expect(
			contrast(readHex(tokens, foreground), readHex(tokens, background)),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each([
		["light control border", light, "--sys-border-control", "--sys-bg-canvas"],
		["light focus ring", light, "--sys-focus-ring", "--sys-bg-canvas"],
		["light selected border", light, "--sys-border-selected", "--sys-surface-default"],
		["dark control border", explicitDark, "--sys-border-control", "--sys-surface-default"],
		["dark focus ring", explicitDark, "--sys-focus-ring", "--sys-surface-default"],
		["dark selected border", explicitDark, "--sys-border-selected", "--sys-surface-default"],
	])("keeps %s at non-text contrast", (_name, tokens, foreground, background) => {
		expect(
			contrast(readHex(tokens, foreground), readHex(tokens, background)),
		).toBeGreaterThanOrEqual(3);
	});
});

function parseBlock(block) {
	if (!block) {
		throw new Error("color token block is missing");
	}
	return new Map(
		[...block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gmu)].map((match) => [
			match[1],
			match[2].trim(),
		]),
	);
}

function readHex(tokens, token) {
	const value = tokens.get(token);
	if (!value?.match(/^#[0-9a-f]{6}$/u)) {
		throw new Error(
			`${token} must resolve to a six-digit hex color, received ${value ?? "missing"}`,
		);
	}
	return value;
}

function contrast(left, right) {
	const leftLuminance = luminance(left);
	const rightLuminance = luminance(right);
	return (
		(Math.max(leftLuminance, rightLuminance) + 0.05) /
		(Math.min(leftLuminance, rightLuminance) + 0.05)
	);
}

function luminance(color) {
	const channel = (offset) => {
		const raw = Number.parseInt(color.slice(offset, offset + 2), 16);
		const value = raw / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	const red = channel(1);
	const green = channel(3);
	const blue = channel(5);
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
