// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPUS_UI_STATE_POLICY } from "../src/features/ui-state/state-policy";

const appRoot = join(import.meta.dirname, "..");
const userInterfaceRoots = ["src/app", "src/components", "src/features", "src/style-dev"] as const;

function sourceFiles(relativeRoot: string, extensions = new Set([".ts", ".tsx"])): string[] {
	const absoluteRoot = join(appRoot, relativeRoot);
	const files: string[] = [];
	for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(relativePath, extensions));
			continue;
		}
		const extension = entry.name.endsWith(".tsx")
			? ".tsx"
			: entry.name.endsWith(".ts")
				? ".ts"
				: "";
		if (extensions.has(extension)) {
			files.push(relativePath);
		}
	}
	return files;
}

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("Campus Web 用户可见状态治理", () => {
	it("keeps the state registry complete and explicit", () => {
		expect(Object.keys(CAMPUS_UI_STATE_POLICY).sort()).toEqual(
			[
				"action-feedback",
				"degraded",
				"empty",
				"error",
				"initial-loading",
				"not-found",
				"refreshing",
				"unavailable",
			].sort(),
		);
		expect(CAMPUS_UI_STATE_POLICY["initial-loading"].defaultPresentation).toBe("skeleton");
		expect(CAMPUS_UI_STATE_POLICY.refreshing.preservesContent).toBe(true);
		expect(CAMPUS_UI_STATE_POLICY.refreshing.userVisible).toBe(false);
		expect(CAMPUS_UI_STATE_POLICY["not-found"].defaultPresentation).toBe("page");
	});

	it("uses StateMessage directly instead of the retired SurfaceState wrapper", () => {
		expect(existsSync(join(appRoot, "src/components/ui/surface-state.tsx"))).toBe(false);
		const productionSource = ["src/app", "src/components", "src/features"]
			.flatMap((root) => sourceFiles(root))
			.map(read)
			.join("\n");
		expect(productionSource).not.toMatch(/\bSurfaceState\b/u);
		expect(productionSource).not.toContain("components/ui/surface-state");
	});

	it("does not expose internal search, request, reasoning, or tool payload wording", () => {
		const visibleSource = userInterfaceRoots
			.flatMap((root) => sourceFiles(root, new Set([".tsx"])))
			.map(read)
			.join("\n");
		for (const forbiddenCopy of [
			"正在载入搜索索引",
			"正在载入搜索",
			"正在搜索",
			"暂无可显示的回答过程",
			"request_id",
		]) {
			expect(visibleSource).not.toContain(forbiddenCopy);
		}

		const toolFallbackSource = read("src/components/assistant-ui/tool-fallback.tsx");
		const reasoningSource = read("src/components/assistant-ui/reasoning.tsx");
		expect(toolFallbackSource).not.toContain("argsText");
		expect(toolFallbackSource).not.toContain("ToolFallbackResult");
		expect(reasoningSource).not.toContain("<ReasoningText>{children}</ReasoningText>");
	});

	it("keeps run phases out of the chat display", () => {
		const styleDevSource = sourceFiles("src/style-dev").map(read).join("\n");
		const threadSource = read("src/components/assistant-ui/thread.tsx");

		expect(styleDevSource).not.toContain('label: "排队"');
		expect(threadSource).toContain("正在回答");
		expect(threadSource).not.toContain("正在准备回答");
		expect(threadSource).not.toContain("回答过程");
	});

	it("keeps ordinary chat content out of success and info colors", () => {
		const threadSource = read("src/components/assistant-ui/thread.tsx");
		const campusStylesSource = read("src/campus-styles.css");

		expect(threadSource).not.toContain('"回答完成"');
		expect(threadSource).not.toContain("text-success");
		expect(threadSource).not.toContain("text-info");
		expect(threadSource).not.toContain("bg-chat-accent-subtle text-chat-accent-text");
		expect(campusStylesSource).toContain("background: var(--chat-message-user-bg);");
		expect(campusStylesSource).toContain("color: var(--chat-message-user-text);");
	});

	it("keeps ordinary route and feature recovery local", () => {
		const recoverableSource = ["src/app", "src/components", "src/features"]
			.flatMap((root) => sourceFiles(root))
			.map(read)
			.join("\n");
		expect(recoverableSource).not.toContain("window.location.reload()");
	});
});
