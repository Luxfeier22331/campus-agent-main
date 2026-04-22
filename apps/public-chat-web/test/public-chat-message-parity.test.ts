import { describe, expect, it } from "vitest";

import messageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";
import messagesSource from "../vendor/vercel-ai-chatbot/components/chat/messages.tsx?raw";

describe("public chat message parity", () => {
	it("removes repo-local tool fallback guards from the donor-visible message path", () => {
		expect(messageSource).not.toContain("function isWeatherAtLocation");
		expect(messageSource).not.toContain("function isDocumentToolPayload");
		expect(messageSource).not.toContain("function hasToolError");
		expect(messageSource).not.toContain("Weather data is unavailable.");
		expect(messageSource).not.toContain("Suggestions data is unavailable.");
		expect(messageSource).not.toContain('state="output-error"');
	});

	it("renders weather and document tool outputs with the donor direct-output contract", () => {
		expect(messageSource).toMatch(
			/<Weather weatherAtLocation=\{part\.output(?: as WeatherAtLocation)?\} \/>/,
		);
		expect(messageSource).toMatch(/result=\{(?:output|part\.output)\}/);
		expect(messageSource).toMatch(/args=\{\{ \.\.\.(?:output|part\.output), isUpdate: true \}\}/);
		expect(messageSource).toMatch(/"error" in (?:output|part\.output)/);
	});

	it("keeps the messages container on the donor thread path without extra repo-owned fallback states", () => {
		expect(messagesSource).toContain("<Greeting />");
		expect(messagesSource).toContain("<PreviewMessage");
		expect(messagesSource).toContain("<ThinkingMessage />");
		expect(messagesSource).not.toContain("route status");
	});
});
