(() => {
	const storageKey = "campus-agent.theme";
	let mode = null;
	// The shared cookie is the cross-subdomain channel; every writer updates both
	// stores, so a valid cookie is at least as fresh as this origin's localStorage.
	try {
		const match = document.cookie.match(new RegExp(`(?:^|; )${storageKey}=([^;]*)`));
		const value = match?.[1] ? decodeURIComponent(match[1]) : null;
		if (value === "light" || value === "dark" || value === "system") {
			mode = value;
		}
	} catch {
		// Cookie read is best-effort.
	}
	if (mode === null) {
		try {
			const stored = window.localStorage.getItem(storageKey);
			if (stored === "light" || stored === "dark" || stored === "system") {
				mode = stored;
			}
		} catch {
			// Storage may be unavailable before the app is interactive.
		}
	}
	if (mode === null) {
		mode = "system";
	}
	const prefersDark =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolvedTheme = mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
	document.documentElement.dataset.theme = resolvedTheme;
	document.documentElement.style.colorScheme = resolvedTheme;
})();
