// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	decryptProviderSecret,
	encryptProviderSecret,
	providerSecretRef,
} from "../src/server/provider-config-crypto.ts";

describe("provider config secret crypto", () => {
	it("round-trips secrets without exposing plaintext metadata", async () => {
		const key = "test-encryption-key";
		const reference = await providerSecretRef("provider-api-key", key);

		expect(reference.ciphertext).toMatch(/^aesgcm:/u);
		expect(reference.ciphertext).not.toContain("provider-api-key");
		expect(reference.last4).toBe("-key");
		await expect(decryptProviderSecret(reference.ciphertext, key)).resolves.toBe(
			"provider-api-key",
		);
	});

	it("rejects missing and incorrect encryption keys", async () => {
		await expect(encryptProviderSecret("secret")).rejects.toMatchObject({
			code: "provider_config_encryption_key_missing",
		});
		const ciphertext = await encryptProviderSecret("secret", "correct-key");
		await expect(decryptProviderSecret(ciphertext, "incorrect-key")).rejects.toMatchObject({
			code: "provider_secret_invalid",
		});
	});
});
