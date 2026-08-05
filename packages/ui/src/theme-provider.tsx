import * as React from "react";
import { flushSync } from "react-dom";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface ThemeProviderProps {
	children: React.ReactNode;
	defaultMode?: ThemeMode;
	storageKey?: string;
}

export interface ThemeContextValue {
	mode: ThemeMode;
	resolvedTheme: ResolvedTheme;
	setMode: (mode: ThemeMode) => void;
}

const DEFAULT_STORAGE_KEY = "campus-agent.theme";
const defaultThemeContext: ThemeContextValue = {
	mode: "system",
	resolvedTheme: "light",
	setMode: () => undefined,
};
const ThemeContext = React.createContext<ThemeContextValue>(defaultThemeContext);

function isThemeMode(value: string | null): value is ThemeMode {
	return value === "system" || value === "light" || value === "dark";
}

function readStoredMode(storageKey: string, fallback: ThemeMode): ThemeMode {
	if (typeof window === "undefined") {
		return fallback;
	}
	try {
		const value = window.localStorage.getItem(storageKey);
		return isThemeMode(value) ? value : fallback;
	} catch {
		return fallback;
	}
}

function systemTheme(): ResolvedTheme {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return "light";
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode, systemResolvedTheme: ResolvedTheme): ResolvedTheme {
	return mode === "system" ? systemResolvedTheme : mode;
}

function applyRootTheme(resolvedTheme: ResolvedTheme) {
	const root = document.documentElement;
	root.dataset.theme = resolvedTheme;
	root.style.colorScheme = resolvedTheme;
}

function canAnimateThemeChange() {
	return (
		typeof document.startViewTransition === "function" &&
		!window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export function ThemeProvider({
	children,
	defaultMode = "system",
	storageKey = DEFAULT_STORAGE_KEY,
}: ThemeProviderProps) {
	// Keep the first render deterministic for prerendered docs; bootstrap.js applies the
	// persisted visual theme before hydration, and this effect synchronizes the control state.
	const [mode, setModeState] = React.useState<ThemeMode>(defaultMode);
	const [systemResolvedTheme, setSystemResolvedTheme] = React.useState<ResolvedTheme>(systemTheme);
	const resolvedTheme = resolveTheme(mode, systemResolvedTheme);
	const modeRef = React.useRef(mode);
	const systemResolvedThemeRef = React.useRef(systemResolvedTheme);
	const activeTransitionRef = React.useRef<ViewTransition | null>(null);
	const commitVersionRef = React.useRef(0);

	const commitTheme = React.useCallback(
		(nextMode: ThemeMode, nextSystemTheme: ResolvedTheme, animate: boolean) => {
			const commitVersion = commitVersionRef.current + 1;
			commitVersionRef.current = commitVersion;
			const previousResolvedTheme = resolveTheme(modeRef.current, systemResolvedThemeRef.current);
			const nextResolvedTheme = resolveTheme(nextMode, nextSystemTheme);
			const activeTransition = activeTransitionRef.current;
			if (activeTransition) {
				activeTransitionRef.current = null;
				activeTransition.skipTransition();
			}

			const updateTheme = () => {
				if (commitVersionRef.current !== commitVersion) {
					return;
				}
				modeRef.current = nextMode;
				systemResolvedThemeRef.current = nextSystemTheme;
				applyRootTheme(nextResolvedTheme);
				setModeState(nextMode);
				setSystemResolvedTheme(nextSystemTheme);
			};

			if (!animate || previousResolvedTheme === nextResolvedTheme || !canAnimateThemeChange()) {
				document.documentElement.removeAttribute("data-theme-transitioning");
				updateTheme();
				return;
			}

			const root = document.documentElement;
			root.dataset.themeTransitioning = "true";
			let transition: ViewTransition;
			try {
				transition = document.startViewTransition(() => {
					flushSync(updateTheme);
				});
			} catch {
				root.removeAttribute("data-theme-transitioning");
				updateTheme();
				return;
			}

			activeTransitionRef.current = transition;
			void transition.finished
				.catch(() => undefined)
				.finally(() => {
					if (activeTransitionRef.current === transition) {
						activeTransitionRef.current = null;
						root.removeAttribute("data-theme-transitioning");
					}
				});
		},
		[],
	);

	React.useEffect(() => {
		const storedMode = readStoredMode(storageKey, defaultMode);
		commitTheme(storedMode, systemTheme(), false);
	}, [commitTheme, defaultMode, storageKey]);

	React.useEffect(() => {
		if (
			mode !== "system" ||
			modeRef.current !== "system" ||
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		) {
			return;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (event: MediaQueryListEvent) => {
			if (modeRef.current === "system") {
				commitTheme("system", event.matches ? "dark" : "light", true);
			}
		};
		const nextSystemTheme = media.matches ? "dark" : "light";
		if (systemResolvedThemeRef.current !== nextSystemTheme) {
			commitTheme("system", nextSystemTheme, false);
		}
		media.addEventListener?.("change", handleChange);
		return () => media.removeEventListener?.("change", handleChange);
	}, [commitTheme, mode]);

	React.useEffect(() => {
		applyRootTheme(resolvedTheme);
	}, [resolvedTheme]);

	React.useEffect(
		() => () => {
			activeTransitionRef.current?.skipTransition();
			activeTransitionRef.current = null;
			document.documentElement.removeAttribute("data-theme-transitioning");
		},
		[],
	);

	const setMode = React.useCallback(
		(nextMode: ThemeMode) => {
			if (typeof window !== "undefined") {
				try {
					window.localStorage.setItem(storageKey, nextMode);
				} catch {
					// Private browsing and restricted storage should not block the setting.
				}
				commitTheme(nextMode, systemTheme(), true);
			}
		},
		[commitTheme, storageKey],
	);

	const value = React.useMemo(
		() => ({ mode, resolvedTheme, setMode }),
		[mode, resolvedTheme, setMode],
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	return React.useContext(ThemeContext);
}
