export function exactSharedSecret(value: string | undefined): string {
	const sharedSecret = value ?? "";
	if (sharedSecret !== sharedSecret.trim()) {
		throw new Error(
			"EXECUTION_AGENT_RUNTIME_SHARED_SECRET must not contain surrounding whitespace",
		);
	}
	return sharedSecret;
}
