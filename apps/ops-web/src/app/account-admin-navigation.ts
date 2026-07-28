export function decodeCursorHistory(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	try {
		const parsed = JSON.parse(atob(value)) as unknown;
		return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
			? parsed.slice(-20)
			: [];
	} catch {
		return [];
	}
}

export function encodeCursorHistory(values: string[]): string | undefined {
	return values.length > 0 ? btoa(JSON.stringify(values.slice(-20))) : undefined;
}

export function normalizeUsersReturnPath(value: string | undefined): string {
	if (!value) {
		return "/users";
	}
	try {
		const url = new URL(value, "https://ops-web.local");
		return url.origin === "https://ops-web.local" &&
			(url.pathname === "/users" || url.pathname === "/users/activity")
			? `${url.pathname}${url.search}`
			: "/users";
	} catch {
		return "/users";
	}
}
