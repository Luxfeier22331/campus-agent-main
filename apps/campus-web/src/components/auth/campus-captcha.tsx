import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { readTurnstileRuntimeConfig } from "@/platform/auth/turnstile-runtime-config";

export interface CampusCaptchaHandle {
	enabled: boolean;
	getToken: () => Promise<string | undefined>;
	reset: () => void;
}

export const CampusCaptcha = forwardRef<CampusCaptchaHandle>(function CampusCaptcha(_, ref) {
	const config = readTurnstileRuntimeConfig();
	const turnstileRef = useRef<TurnstileInstance>(undefined);
	const pendingToken = useRef<((token: string | undefined) => void) | null>(null);

	const settleToken = useCallback((token: string | undefined) => {
		pendingToken.current?.(token);
		pendingToken.current = null;
	}, []);

	useImperativeHandle(
		ref,
		() => ({
			enabled: Boolean(config.turnstileSiteKey),
			getToken: async () => {
				if (!config.turnstileSiteKey) {
					return;
				}
				const currentToken = turnstileRef.current?.getResponse();
				if (currentToken) {
					return currentToken;
				}
				if (config.turnstileExecution !== "execute" || !turnstileRef.current) {
					return;
				}
				return new Promise<string | undefined>((resolve) => {
					pendingToken.current = resolve;
					turnstileRef.current?.execute();
				});
			},
			reset: () => {
				settleToken(undefined);
				turnstileRef.current?.reset();
			},
		}),
		[config.turnstileExecution, config.turnstileSiteKey, settleToken],
	);

	if (!config.turnstileSiteKey) {
		return null;
	}

	return (
		<Turnstile
			className="my-1 max-w-full overflow-hidden"
			onError={() => settleToken(undefined)}
			onExpire={() => settleToken(undefined)}
			onSuccess={(token) => settleToken(token)}
			onTimeout={() => settleToken(undefined)}
			onUnsupported={() => settleToken(undefined)}
			options={{
				appearance: config.turnstileAppearance,
				execution: config.turnstileExecution,
				language: "zh-CN",
				size: "flexible",
				theme: "auto",
			}}
			ref={turnstileRef}
			siteKey={config.turnstileSiteKey}
		/>
	);
});
