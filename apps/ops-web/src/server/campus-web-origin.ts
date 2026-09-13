export function resolveCampusWebPublicOrigin(value: string | undefined): string | undefined {
	const configured = value?.trim();
	if (!configured) {
		return;
	}
	try {
		const parsed = new URL(configured);
		const allowedProtocol =
			parsed.protocol === "https:" ||
			(parsed.protocol === "http:" &&
				(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"));
		const isOriginOnly =
			!(parsed.username || parsed.password) &&
			parsed.pathname === "/" &&
			!parsed.search &&
			!parsed.hash;
		return allowedProtocol && isOriginOnly ? parsed.origin : undefined;
	} catch {
		return;
	}
}
