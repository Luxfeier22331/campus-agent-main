import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef, useImperativeHandle, useRef } from "react";

import { readTurnstileRuntimeConfig } from "@/platform/auth/turnstile-runtime-config";

export interface CampusCaptchaHandle {
	enabled: boolean;
	getToken: () => Promise<string | undefined>;
	reset: () => void;
}

export const CampusCaptcha = forwardRef<CampusCaptchaHandle>(function CampusCaptcha(_, ref) {
	const config = readTurnstileRuntimeConfig();
	const turnstileRef = useRef<TurnstileInstance>(undefined);

	useImperativeHandle(
		ref,
		() => ({
			enabled: Boolean(config.turnstileSiteKey),
			getToken: async () => {
				if (!config.turnstileSiteKey) {
					return;
				}
				const turnstile = turnstileRef.current;
				if (!turnstile) {
					return;
				}
				try {
					const currentToken = turnstile.getResponse();
					if (currentToken) {
						return currentToken;
					}
					if (config.turnstileExecution === "execute") {
						turnstile.execute();
					}
					return await turnstile.getResponsePromise(30_000);
				} catch {
					return;
				}
			},
			reset: () => {
				turnstileRef.current?.reset();
			},
		}),
		[config.turnstileExecution, config.turnstileSiteKey],
	);

	if (!config.turnstileSiteKey) {
		return null;
	}

	return (
		<Turnstile
			className="my-1 max-w-full overflow-hidden"
			options={{
				appearance: config.turnstileAppearance,
				execution: config.turnstileExecution,
				language: "zh-cn",
				size: "flexible",
				theme: "auto",
			}}
			ref={turnstileRef}
			siteKey={config.turnstileSiteKey}
		/>
	);
});
