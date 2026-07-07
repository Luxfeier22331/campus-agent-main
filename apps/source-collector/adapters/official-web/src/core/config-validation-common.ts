export function assertNonEmpty(value: string, fieldName: string): void {
	if (!value) {
		throw new Error(`${fieldName} is required`);
	}
}

export function ensureUnique(values: string[], fieldName: string): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`${fieldName} must not contain duplicates`);
	}
}

export function ensureSameSet(left: string[], right: string[], fieldName: string): void {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	if (leftSet.size !== rightSet.size) {
		throw new Error(`${fieldName} set mismatch`);
	}
	for (const item of leftSet) {
		if (!rightSet.has(item)) {
			throw new Error(`${fieldName} set mismatch`);
		}
	}
}

export function ensureNoOverlap(left: string[], right: string[], fieldName: string): void {
	const rightSet = new Set(right);
	for (const item of left) {
		if (rightSet.has(item)) {
			throw new Error(`${fieldName} must not overlap`);
		}
	}
}

export function validateRegexList(values: string[], fieldName: string): void {
	for (const value of values) {
		try {
			new RegExp(value, "i");
		} catch (error) {
			throw new Error(
				`${fieldName} contains invalid regex ${value}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

export function validateHostName(value: string, fieldName: string): void {
	assertNonEmpty(value, fieldName);
	if (value !== value.toLowerCase()) {
		throw new Error(`${fieldName} must be lowercase`);
	}
	if (value.includes("*") || value.includes("/") || value.includes(":")) {
		throw new Error(`${fieldName} must be a bare host name`);
	}
}

export function validateSeedUrl(
	rawUrl: string,
	expectedHost: string,
	queryParamAllowlist: string[],
): void {
	const parsed = new URL(rawUrl);
	if (parsed.protocol !== "https:") {
		throw new Error(`seed ${rawUrl} must use https`);
	}
	if (parsed.hostname !== expectedHost) {
		throw new Error(`seed ${rawUrl} must stay on host ${expectedHost}`);
	}
	if (parsed.hash) {
		throw new Error(`seed ${rawUrl} must not include a fragment`);
	}
	for (const name of parsed.searchParams.keys()) {
		if (!queryParamAllowlist.includes(name)) {
			throw new Error(`seed ${rawUrl} uses unapproved query parameter ${name}`);
		}
	}
}

export function validateSourceUrl(rawUrl: string, sourceHosts: string[], fieldName: string): void {
	const parsed = new URL(rawUrl);
	if (parsed.protocol !== "https:") {
		throw new Error(`${fieldName} ${rawUrl} must use https`);
	}
	if (parsed.hash) {
		throw new Error(`${fieldName} ${rawUrl} must not include a fragment`);
	}
	if (!sourceHosts.includes(parsed.hostname)) {
		throw new Error(`${fieldName} ${rawUrl} must stay on declared source hosts`);
	}
}
