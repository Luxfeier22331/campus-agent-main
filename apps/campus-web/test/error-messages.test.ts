import { describe, expect, it } from "vitest";

import {
	containsCjkText,
	GENERIC_CHAT_REQUEST_ERROR_MESSAGE,
	localizeChatErrorMessage,
} from "../src/features/conversation/error-messages";

describe("containsCjkText", () => {
	it("detects CJK text", () => {
		expect(containsCjkText("回答失败，请稍后重试。")).toBe(true);
		expect(containsCjkText("请求失败。")).toBe(true);
	});

	it("rejects non-CJK text", () => {
		expect(containsCjkText("The request could not be completed.")).toBe(false);
		expect(containsCjkText("")).toBe(false);
		expect(containsCjkText("execution_status_pending")).toBe(false);
	});
});

describe("localizeChatErrorMessage", () => {
	it("maps known error codes to Chinese text", () => {
		expect(localizeChatErrorMessage({ code: "execution_status_pending" })).toBe(
			"回答仍在处理中，请稍候。",
		);
		expect(localizeChatErrorMessage({ code: "run_failed", message: "irrelevant" })).toBe(
			GENERIC_CHAT_REQUEST_ERROR_MESSAGE,
		);
		expect(localizeChatErrorMessage({ code: "execution_cancelled" })).toBe("已取消本次回答。");
		expect(localizeChatErrorMessage({ code: "request_cancel_failed" })).toBe(
			"取消请求失败，当前回答仍在继续。",
		);
	});

	it("keeps server messages that already contain Chinese", () => {
		expect(
			localizeChatErrorMessage({
				code: "materials_insufficient",
				message: "暂未找到足够的校内资料来回答这个问题。",
			}),
		).toBe("暂未找到足够的校内资料来回答这个问题。");
		expect(localizeChatErrorMessage({ code: "unknown_code", message: "请求失败，请重试。" })).toBe(
			"请求失败，请重试。",
		);
	});

	it("replaces English server messages with the generic Chinese message", () => {
		expect(
			localizeChatErrorMessage({
				code: "unknown_code",
				message: "The request could not be completed.",
			}),
		).toBe(GENERIC_CHAT_REQUEST_ERROR_MESSAGE);
		expect(localizeChatErrorMessage({ code: null, message: "Unexpected failure." })).toBe(
			GENERIC_CHAT_REQUEST_ERROR_MESSAGE,
		);
	});

	it("falls back to the generic Chinese message when nothing is usable", () => {
		expect(localizeChatErrorMessage({})).toBe(GENERIC_CHAT_REQUEST_ERROR_MESSAGE);
		expect(localizeChatErrorMessage({ code: "  ", message: "   " })).toBe(
			GENERIC_CHAT_REQUEST_ERROR_MESSAGE,
		);
	});
});
