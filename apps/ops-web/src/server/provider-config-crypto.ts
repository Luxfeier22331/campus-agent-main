import { createHash } from "node:crypto";
import type { ProviderConfigSecretRef } from "@campus-agent/provider-config";
import { ProviderConfigError } from "@campus-agent/provider-config";

export async function providerSecretRef(
	plaintext: string,
	encryptionKey: string | undefined,
): Promise<ProviderConfigSecretRef> {
	const value = plaintext.trim();
	if (!value) {
		throw new ProviderConfigError("provider_secret_required", "密钥不能为空。", 422);
	}
	return {
		ciphertext: await encryptProviderSecret(value, encryptionKey),
		fingerprint: createHash("sha256").update(value).digest("hex"),
		last4: value.slice(-4),
	};
}

export async function encryptProviderSecret(value: string, keyMaterial?: string): Promise<string> {
	const key = await encryptionKey(keyMaterial);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ iv, name: "AES-GCM" },
		key,
		new TextEncoder().encode(value),
	);
	return `aesgcm:${Buffer.from(iv).toString("base64url")}:${Buffer.from(encrypted).toString("base64url")}`;
}

export async function decryptProviderSecret(value: string, keyMaterial?: string): Promise<string> {
	const [scheme, iv, payload] = value.split(":");
	if (scheme !== "aesgcm" || !iv || !payload) {
		throw new ProviderConfigError("provider_secret_invalid", "模型服务密钥无法解密。", 500);
	}
	try {
		const decrypted = await crypto.subtle.decrypt(
			{ iv: new Uint8Array(Buffer.from(iv, "base64url")), name: "AES-GCM" },
			await encryptionKey(keyMaterial),
			new Uint8Array(Buffer.from(payload, "base64url")),
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		throw new ProviderConfigError("provider_secret_invalid", "模型服务密钥无法解密。", 500);
	}
}

async function encryptionKey(value?: string): Promise<CryptoKey> {
	if (!value?.trim()) {
		throw new ProviderConfigError(
			"provider_config_encryption_key_missing",
			"模型服务配置加密密钥未配置。",
			503,
		);
	}
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim()));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
