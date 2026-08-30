// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("resend", () => ({
	Resend: class {
		readonly emails = { send };
	},
}));

import { createResendEmailSender } from "../src/modules/auth/reset-mail";

const message = {
	from: "Campus Agent <account@auth.muc.wiki>",
	html: "<p>test</p>",
	replyTo: "Campus Agent <account@auth.muc.wiki>",
	subject: "Test",
	text: "test",
	to: "student@muc.edu.cn",
};

describe("Resend authentication email sender", () => {
	beforeEach(() => {
		send.mockReset();
	});

	it("adds stable tags and forwards the idempotency key", async () => {
		send.mockResolvedValue({ data: { id: "email-1" }, error: null });
		const sender = createResendEmailSender("resend-test-key");

		await expect(
			sender.send(message, {
				idempotencyKey: "campus-auth/email_verification/hash",
				purpose: "email_verification",
			}),
		).resolves.toEqual({ id: "email-1" });
		expect(send).toHaveBeenCalledWith(
			{
				...message,
				tags: [
					{ name: "app", value: "campus-agent" },
					{ name: "purpose", value: "email_verification" },
				],
				to: [message.to],
			},
			{ idempotencyKey: "campus-auth/email_verification/hash" },
		);
	});

	it("propagates provider rejections and missing message identifiers", async () => {
		const sender = createResendEmailSender("resend-test-key");
		send.mockResolvedValueOnce({
			data: null,
			error: { message: "invalid sender", name: "validation_error" },
		});
		await expect(sender.send(message, { purpose: "password_reset" })).rejects.toThrow(
			"validation_error",
		);

		send.mockResolvedValueOnce({ data: {}, error: null });
		await expect(sender.send(message, { purpose: "password_reset" })).rejects.toThrow(
			"without returning an email id",
		);
	});

	it("propagates transport failures without custom retry", async () => {
		const sender = createResendEmailSender("resend-test-key");
		send.mockRejectedValue(new Error("network unavailable"));

		await expect(sender.send(message, { purpose: "password_changed" })).rejects.toThrow(
			"network unavailable",
		);
		expect(send).toHaveBeenCalledOnce();
	});
});
