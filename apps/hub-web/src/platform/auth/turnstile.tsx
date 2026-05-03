"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	parseTurnstileRuntimeConfigSource,
	type TurnstileRuntimeConfig,
} from "./turnstile-runtime-config";

const TURNSTILE_SCRIPT_URL =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type AuthTurnstileAction = "sign-in" | "sign-up" | "request-password-reset";

export interface AuthTurnstileController {
	ensureToken: () => Promise<boolean>;
	resetToken: () => void;
}

interface TurnstileWidget {
	execute?: (widgetId: string) => void;
	remove?: (widgetId: string) => void;
	reset?: (widgetId: string) => void;
	render: (container: HTMLElement | string, options: Record<string, unknown>) => string;
}

declare global {
	interface Window {
		turnstile?: TurnstileWidget;
	}
}

let turnstileScriptPromise: Promise<void> | null = null;

function readTurnstileRuntimeConfig(): TurnstileRuntimeConfig {
	if (typeof document === "undefined") {
		return parseTurnstileRuntimeConfigSource(null);
	}

	const script = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID);
	return parseTurnstileRuntimeConfigSource(script?.textContent);
}

async function loadTurnstileScript(): Promise<void> {
	if (typeof window === "undefined") {
		return;
	}
	if (window.turnstile) {
		return;
	}
	if (turnstileScriptPromise) {
		return turnstileScriptPromise;
	}

	turnstileScriptPromise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			'script[data-auth-turnstile="true"]',
		);
		if (existing) {
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener(
				"error",
				() => {
					turnstileScriptPromise = null;
					reject(new Error("Turnstile script failed to load."));
				},
				{ once: true },
			);
			return;
		}

		const script = document.createElement("script");
		script.async = true;
		script.dataset.authTurnstile = "true";
		script.defer = true;
		script.src = TURNSTILE_SCRIPT_URL;
		script.onload = () => resolve();
		script.onerror = () => {
			turnstileScriptPromise = null;
			reject(new Error("Turnstile script failed to load."));
		};
		document.head.appendChild(script);
	});

	return turnstileScriptPromise;
}

export function AuthTurnstileField(props: {
	action: AuthTurnstileAction;
	onController?: (controller: AuthTurnstileController | null) => void;
}) {
	const { action, onController } = props;
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [challengeRequestId, setChallengeRequestId] = useState(0);
	const [isPrimed, setIsPrimed] = useState(false);
	const [token, setToken] = useState("");
	const [runtimeConfig, setRuntimeConfig] = useState<TurnstileRuntimeConfig>(() =>
		readTurnstileRuntimeConfig(),
	);
	const containerId = useId();
	const widgetIdRef = useRef<string | null>(null);
	const widgetConfigKeyRef = useRef<string | null>(null);
	const widgetRef = useRef<HTMLDivElement | null>(null);
	const tokenInputRef = useRef<HTMLInputElement | null>(null);
	const tokenRef = useRef("");
	const pendingEnsureResolversRef = useRef<Array<(didResolve: boolean) => void>>([]);
	const { turnstileAppearance, turnstileExecution, turnstileSiteKey: siteKey } = runtimeConfig;

	const commitToken = useEffectEvent((nextToken: string) => {
		tokenRef.current = nextToken;
		setToken(nextToken);
		if (tokenInputRef.current) {
			tokenInputRef.current.value = nextToken;
		}
	});

	const resolvePendingEnsures = useEffectEvent((didResolve: boolean) => {
		const resolvers = pendingEnsureResolversRef.current.splice(0);
		for (const resolve of resolvers) {
			resolve(didResolve);
		}
	});

	const ensureToken = useEffectEvent(async () => {
		if (!siteKey) {
			setErrorMessage("暂时无法加载安全验证。");
			return false;
		}

		if (tokenRef.current) {
			return true;
		}

		setErrorMessage(null);
		setIsPrimed(true);
		setChallengeRequestId((current) => current + 1);

		return new Promise<boolean>((resolve) => {
			pendingEnsureResolversRef.current.push(resolve);
		});
	});

	const resetToken = useEffectEvent(() => {
		commitToken("");
		setErrorMessage(null);
		resolvePendingEnsures(false);
		if (widgetIdRef.current && window.turnstile?.reset) {
			window.turnstile.reset(widgetIdRef.current);
		}
	});

	useEffect(() => {
		setRuntimeConfig(readTurnstileRuntimeConfig());
	}, []);

	useEffect(() => {
		if (!(isPrimed && siteKey && widgetRef.current)) {
			return;
		}

		let cancelled = false;
		const isChallengeRequested = challengeRequestId > 0;
		const widgetConfigKey = [action, siteKey, turnstileAppearance, turnstileExecution].join(":");

		void loadTurnstileScript()
			.then(() => {
				if (cancelled || !widgetRef.current || !window.turnstile) {
					return;
				}

				setErrorMessage(null);

				if (widgetIdRef.current && widgetConfigKeyRef.current !== widgetConfigKey) {
					if (window.turnstile.remove) {
						window.turnstile.remove(widgetIdRef.current);
					} else {
						widgetRef.current.innerHTML = "";
					}
					widgetIdRef.current = null;
					widgetConfigKeyRef.current = null;
				}

				if (!widgetIdRef.current) {
					widgetIdRef.current = window.turnstile.render(widgetRef.current, {
						action,
						appearance: turnstileAppearance,
						callback(value: unknown) {
							commitToken(typeof value === "string" ? value : "");
							setErrorMessage(null);
							resolvePendingEnsures(true);
						},
						execution: turnstileExecution,
						"error-callback"() {
							commitToken("");
							setErrorMessage("安全验证未通过，请重试。");
							resolvePendingEnsures(false);
						},
						"expired-callback"() {
							commitToken("");
							setErrorMessage("安全验证已失效，请重新完成。");
							resolvePendingEnsures(false);
						},
						sitekey: siteKey,
						theme: "light",
					});
					widgetConfigKeyRef.current = widgetConfigKey;
				}

				if (
					isChallengeRequested &&
					turnstileExecution === "execute" &&
					widgetIdRef.current &&
					window.turnstile.execute
				) {
					window.turnstile.execute(widgetIdRef.current);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setErrorMessage("暂时无法加载安全验证。");
					resolvePendingEnsures(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [action, challengeRequestId, isPrimed, siteKey, turnstileAppearance, turnstileExecution]);

	useEffect(
		() => () => {
			commitToken("");
			resolvePendingEnsures(false);
			if (widgetIdRef.current && window.turnstile?.remove) {
				window.turnstile.remove(widgetIdRef.current);
			} else if (widgetRef.current) {
				widgetRef.current.innerHTML = "";
			}
			widgetIdRef.current = null;
			widgetConfigKeyRef.current = null;
		},
		[],
	);

	useEffect(() => {
		if (!onController) {
			return;
		}

		onController({
			ensureToken,
			resetToken,
		});

		return () => {
			onController(null);
		};
	}, [onController]);

	return (
		<div className="flex flex-col gap-2">
			<input
				id="captchaToken"
				name="captchaToken"
				readOnly
				ref={tokenInputRef}
				type="hidden"
				value={token}
			/>
			{siteKey ? (
				<div data-slot="auth-turnstile" id={containerId} ref={widgetRef} />
			) : (
				<p className="text-sm text-destructive">暂时无法加载安全验证。</p>
			)}
			{errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
		</div>
	);
}
