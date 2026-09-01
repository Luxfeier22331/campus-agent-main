// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const campusSource = readFileSync("src/design/tokens.css", "utf8");
const campusStyles = readFileSync("src/campus-styles.css", "utf8");
const appStyles = readFileSync("src/app-styles.css", "utf8");
const sharedSource = readFileSync("../../packages/ui/src/tokens.css", "utf8");
const sharedThemeSource = readFileSync("../../packages/ui/src/theme.css", "utf8");
const opsStyles = readFileSync("../ops-web/src/styles.css", "utf8");

const campusLight = parseBlock(campusSource.match(/^:root\s*\{([\s\S]*?)\n\}/u)?.[1]);
const campusExplicitDark = parseBlock(
	campusSource.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/u)?.[1],
);
const campusSystemDark = parseBlock(
	campusSource.match(
		/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \{([\s\S]*?)\n\t\}\n\}/u,
	)?.[1],
);
const sharedLight = parseBlock(sharedSource.match(/^:root\s*\{([\s\S]*?)\n\}/u)?.[1]);
const sharedDark = parseBlock(
	sharedSource.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/u)?.[1],
);
const campusEffectiveDark = new Map([...campusLight, ...campusExplicitDark]);

const CAMPUS_COLOR_TOKENS = [
	"--campus-brand-identity",
	"--campus-brand-subtle",
	"--campus-action",
	"--campus-action-hover",
	"--campus-action-pressed",
	"--campus-action-foreground",
	"--campus-selected-bg",
	"--campus-selected-hover",
	"--campus-selected-pressed",
	"--campus-selected-foreground",
	"--campus-selected-border",
	"--campus-focus-ring",
	"--campus-link",
	"--campus-link-hover",
	"--chat-accent",
	"--chat-accent-hover",
	"--chat-accent-pressed",
	"--chat-accent-foreground",
	"--chat-accent-subtle",
	"--chat-accent-subtle-hover",
	"--chat-accent-text",
	"--chat-accent-border",
] as const;

describe("Campus color token contract", () => {
	it("uses the approved ink and chat palettes", () => {
		expect(readTokens(campusLight, CAMPUS_COLOR_TOKENS)).toEqual({
			"--campus-action": "#2f2f2f",
			"--campus-action-foreground": "#ffffff",
			"--campus-action-hover": "#1f1f1f",
			"--campus-action-pressed": "#111113",
			"--campus-brand-identity": "#262627",
			"--campus-brand-subtle": "#ececee",
			"--campus-focus-ring": "#5e5e65",
			"--campus-link": "#343437",
			"--campus-link-hover": "#111113",
			"--campus-selected-bg": "#e8e8eb",
			"--campus-selected-border": "#6f6f76",
			"--campus-selected-foreground": "#1c1c1e",
			"--campus-selected-hover": "#dfdfe3",
			"--campus-selected-pressed": "#d4d4da",
			"--chat-accent": "#0f7c67",
			"--chat-accent-border": "#4e8f7f",
			"--chat-accent-foreground": "#ffffff",
			"--chat-accent-hover": "#0b6a58",
			"--chat-accent-pressed": "#085446",
			"--chat-accent-subtle": "#e2f2ed",
			"--chat-accent-subtle-hover": "#d4ebe4",
			"--chat-accent-text": "#0a5e4e",
		});
		expect(readTokens(campusExplicitDark, CAMPUS_COLOR_TOKENS)).toEqual({
			"--campus-action": "#f1f1f3",
			"--campus-action-foreground": "#151517",
			"--campus-action-hover": "#f7f7f8",
			"--campus-action-pressed": "#d7d7dc",
			"--campus-brand-identity": "#e8e8eb",
			"--campus-brand-subtle": "#2a2a2d",
			"--campus-focus-ring": "#b7b7bd",
			"--campus-link": "#dedee2",
			"--campus-link-hover": "#f7f7f8",
			"--campus-selected-bg": "#2a2a2d",
			"--campus-selected-border": "#8c8c94",
			"--campus-selected-foreground": "#f5f5f7",
			"--campus-selected-hover": "#333336",
			"--campus-selected-pressed": "#3d3d41",
			"--chat-accent": "#4bc3ac",
			"--chat-accent-border": "#5bbba8",
			"--chat-accent-foreground": "#151517",
			"--chat-accent-hover": "#65d1bd",
			"--chat-accent-pressed": "#36a994",
			"--chat-accent-subtle": "#1f3934",
			"--chat-accent-subtle-hover": "#294942",
			"--chat-accent-text": "#8edecb",
		});
	});

	it("keeps explicit and system dark mode on the same application contract", () => {
		expect(readTokens(campusSystemDark, CAMPUS_COLOR_TOKENS)).toEqual(
			readTokens(campusExplicitDark, CAMPUS_COLOR_TOKENS),
		);
	});

	it("keeps conversation content neutral and separate from the chat accent", () => {
		const messageTokens = [
			"--chat-message-user-bg",
			"--chat-message-user-text",
			"--chat-message-user-meta",
		] as const;
		expect(readTokens(campusLight, messageTokens)).toEqual({
			"--chat-message-user-bg": "var(--sys-bg-muted)",
			"--chat-message-user-text": "var(--sys-text-default)",
			"--chat-message-user-meta": "var(--sys-text-muted)",
		});
		expect(readTokens(campusEffectiveDark, messageTokens)).toEqual(
			readTokens(campusLight, messageTokens),
		);
		expect(campusStyles).toContain("--color-chat-message-user-bg: var(--chat-message-user-bg);");
		expect(campusStyles).toContain(
			"--color-chat-message-user-text: var(--chat-message-user-text);",
		);
	});

	it.each([
		["light user message", campusLight, sharedLight],
		["dark user message", campusEffectiveDark, sharedDark],
	] as const)("keeps %s at WCAG AA text contrast", (_name, campus, shared) => {
		expect(
			contrast(
				readResolvedHex(campus, shared, "--chat-message-user-text"),
				readResolvedHex(campus, shared, "--chat-message-user-bg"),
			),
		).toBeGreaterThanOrEqual(4.5);
		expect(
			contrast(
				readResolvedHex(campus, shared, "--chat-message-user-meta"),
				readResolvedHex(campus, shared, "--chat-message-user-bg"),
			),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each([
		["light primary", campusLight, "--campus-action-foreground", "--campus-action"],
		["light primary hover", campusLight, "--campus-action-foreground", "--campus-action-hover"],
		["light primary pressed", campusLight, "--campus-action-foreground", "--campus-action-pressed"],
		["light selected", campusLight, "--campus-selected-foreground", "--campus-selected-bg"],
		["light chat solid", campusLight, "--chat-accent-foreground", "--chat-accent"],
		["light chat accent subtle", campusLight, "--chat-accent-text", "--chat-accent-subtle"],
		["dark primary", campusExplicitDark, "--campus-action-foreground", "--campus-action"],
		[
			"dark primary pressed",
			campusExplicitDark,
			"--campus-action-foreground",
			"--campus-action-pressed",
		],
		["dark selected", campusExplicitDark, "--campus-selected-foreground", "--campus-selected-bg"],
		["dark chat solid", campusExplicitDark, "--chat-accent-foreground", "--chat-accent"],
		["dark chat accent subtle", campusExplicitDark, "--chat-accent-text", "--chat-accent-subtle"],
	] as const)("keeps %s at WCAG AA text contrast", (_name, tokens, foreground, background) => {
		expect(
			contrast(readHex(tokens, foreground), readHex(tokens, background)),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each([
		["light link", campusLight, "--campus-link", sharedLight, "--sys-surface-default"],
		["dark link", campusExplicitDark, "--campus-link", sharedDark, "--sys-surface-default"],
	] as const)(
		"keeps %s at WCAG AA text contrast",
		(_name, foregroundTokens, foreground, backgroundTokens, background) => {
			expect(
				contrast(readHex(foregroundTokens, foreground), readHex(backgroundTokens, background)),
			).toBeGreaterThanOrEqual(4.5);
		},
	);

	it.each([
		["light focus", campusLight, "--campus-focus-ring", sharedLight, "--sys-bg-canvas"],
		[
			"light selected border",
			campusLight,
			"--campus-selected-border",
			sharedLight,
			"--sys-surface-default",
		],
		[
			"light chat border",
			campusLight,
			"--chat-accent-border",
			sharedLight,
			"--sys-surface-default",
		],
		["dark focus", campusExplicitDark, "--campus-focus-ring", sharedDark, "--sys-surface-default"],
		[
			"dark selected border",
			campusExplicitDark,
			"--campus-selected-border",
			sharedDark,
			"--sys-surface-default",
		],
	] as const)(
		"keeps %s at non-text contrast",
		(_name, foregroundTokens, foreground, backgroundTokens, background) => {
			expect(
				contrast(readHex(foregroundTokens, foreground), readHex(backgroundTokens, background)),
			).toBeGreaterThanOrEqual(3);
		},
	);

	it("maps Campus utilities and integrations without redefining shared system tokens", () => {
		expect(campusSource).not.toMatch(/^\s*--sys-[a-z0-9-]+\s*:/gmu);
		expect(campusStyles).toContain("--color-primary: var(--campus-action);");
		expect(campusStyles).toContain("--color-selected: var(--campus-selected-bg);");
		expect(campusStyles).toContain("--color-link: var(--campus-link);");
		expect(campusStyles).toContain("--color-ring: var(--campus-focus-ring);");
		expect(appStyles).toContain("--accent: var(--campus-action);");
		expect(appStyles).toContain("--field-border-focus: var(--campus-focus-ring);");
		expect(sharedThemeSource).toContain('@import "tw-animate-css";');
	});

	it("leaves shared and Ops color ownership unchanged", () => {
		expect(sharedLight.get("--sys-tint")).toBe("#0b308f");
		expect(sharedDark.get("--sys-tint")).toBe("#9ab2f2");
		expect(opsStyles).toContain("--ops-chart-primary: var(--sys-tint);");
	});

	it("keeps the chat accent inside chat and style-review boundaries", () => {
		const offenders = sourceFiles("src").filter((path) => {
			if (!readFileSync(path, "utf8").includes("chat-accent")) {
				return false;
			}
			return ![
				"src/design/tokens.css",
				"src/campus-styles.css",
				"src/components/assistant-ui/",
				"src/components/conversation/",
				"src/style-dev/",
			].some((allowed) => path === allowed || path.startsWith(allowed));
		});

		expect(offenders).toEqual([]);
	});
});

function parseBlock(block: string | undefined): Map<string, string> {
	if (!block) {
		throw new Error("color token block is missing");
	}
	return new Map(
		[...block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gmu)].map((match) => [
			match[1] as string,
			(match[2] as string).trim(),
		]),
	);
}

function readTokens(tokens: Map<string, string>, names: readonly string[]) {
	return Object.fromEntries(names.map((name) => [name, tokens.get(name)]));
}

function readHex(tokens: Map<string, string>, token: string): string {
	const value = tokens.get(token);
	if (!value?.match(/^#[0-9a-f]{6}$/u)) {
		throw new Error(
			`${token} must resolve to a six-digit hex color, received ${value ?? "missing"}`,
		);
	}
	return value;
}

function readResolvedHex(
	localTokens: Map<string, string>,
	sharedTokens: Map<string, string>,
	token: string,
): string {
	const value = resolveToken(localTokens, sharedTokens, token, new Set());
	if (!value?.match(/^#[0-9a-f]{6}$/u)) {
		throw new Error(
			`${token} must resolve to a six-digit hex color, received ${value ?? "missing"}`,
		);
	}
	return value;
}

function resolveToken(
	localTokens: Map<string, string>,
	sharedTokens: Map<string, string>,
	token: string,
	seen: Set<string>,
): string | undefined {
	if (seen.has(token)) {
		throw new Error(`circular color token reference: ${token}`);
	}
	seen.add(token);
	const value = localTokens.get(token) ?? sharedTokens.get(token);
	const reference = value?.match(/^var\((--[a-z0-9-]+)\)$/u)?.[1];
	return reference ? resolveToken(localTokens, sharedTokens, reference, seen) : value;
}

function contrast(left: string, right: string): number {
	const leftLuminance = luminance(left);
	const rightLuminance = luminance(right);
	return (
		(Math.max(leftLuminance, rightLuminance) + 0.05) /
		(Math.min(leftLuminance, rightLuminance) + 0.05)
	);
}

function luminance(color: string): number {
	const channel = (offset: number) => {
		const raw = Number.parseInt(color.slice(offset, offset + 2), 16);
		const value = raw / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function sourceFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return sourceFiles(path);
		}
		return /\.(?:css|ts|tsx)$/u.test(entry.name) ? [path] : [];
	});
}
