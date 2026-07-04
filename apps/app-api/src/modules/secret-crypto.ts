import { createHash } from "node:crypto";

import { AppApiRouteError } from "../http";
import type { ProviderConfigSecretRef } from "./provider-config/types";

export interface SecretCryptoErrorMessages {
	invalidCiphertextCode: string;
	invalidCiphertextMessage: string;
	missingKeyCode: string;
	missingKeyMessage: string;
}

export async function secretRefFromPlaintext(
	plaintext: string,
	encryptSecret: (plaintext: string) => Promise<string> | string,
): Promise<ProviderConfigSecretRef> {
	const trimmed = plaintext.trim();
	return {
		ciphertext: await encryptSecret(trimmed),
		fingerprint: createHash("sha256").update(trimmed).digest("hex"),
		last4: trimmed.slice(-4),
	};
}

export async function encryptAppApiSecret(
	plaintext: string,
	encryptionKey: string | undefined,
	errors: SecretCryptoErrorMessages,
): Promise<string> {
	const key = await appApiSecretAesKey(encryptionKey, errors);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ iv, name: "AES-GCM" },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `aesgcm:${base64url(iv)}:${base64url(new Uint8Array(encrypted))}`;
}

export async function decryptAppApiSecret(
	ciphertext: string,
	encryptionKey: string | undefined,
	errors: SecretCryptoErrorMessages,
): Promise<string> {
	const [scheme, ivEncoded, payloadEncoded] = ciphertext.split(":");
	if (scheme !== "aesgcm" || !ivEncoded || !payloadEncoded) {
		throw routeError({
			code: errors.invalidCiphertextCode,
			message: errors.invalidCiphertextMessage,
			status: 500,
		});
	}
	const key = await appApiSecretAesKey(encryptionKey, errors);
	const decrypted = await crypto.subtle.decrypt(
		{ iv: base64urlDecode(ivEncoded), name: "AES-GCM" },
		key,
		base64urlDecode(payloadEncoded),
	);
	return new TextDecoder().decode(decrypted);
}

async function appApiSecretAesKey(
	encryptionKey: string | undefined,
	errors: SecretCryptoErrorMessages,
): Promise<CryptoKey> {
	const secret = encryptionKey?.trim();
	if (!secret) {
		throw routeError({
			code: errors.missingKeyCode,
			message: errors.missingKeyMessage,
			status: 503,
		});
	}
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64url(value: Uint8Array): string {
	return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(value, "base64url"));
}

function routeError(input: { code: string; message: string; status: number }): AppApiRouteError {
	return new AppApiRouteError({
		...input,
		retryable: false,
	});
}
