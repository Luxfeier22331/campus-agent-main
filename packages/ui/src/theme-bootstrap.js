(() => {
	const storageKey = "campus-agent.theme";
	let mode = "system";
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (stored === "light" || stored === "dark" || stored === "system") {
			mode = stored;
		}
	} catch {
		// Storage may be unavailable before the app is interactive.
	}
	const prefersDark =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolvedTheme = mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
	document.documentElement.dataset.theme = resolvedTheme;
	document.documentElement.style.colorScheme = resolvedTheme;
})();
