import { useEffect, useState } from "react";

import { readCampusAuthRetryAfterSeconds } from "@/platform/auth/client";
import type { CampusCaptchaHandle } from "./campus-captcha";

export async function resolveCaptchaHeaders(
	captcha: CampusCaptchaHandle | null,
): Promise<HeadersInit | undefined> {
	if (!captcha?.enabled) {
		return;
	}
	const token = await captcha.getToken();
	if (!token) {
		throw Object.assign(new Error("安全验证还没有完成，请稍后再试。"), {
			error: { code: "MISSING_RESPONSE", message: "安全验证还没有完成，请稍后再试。" },
		});
	}
	return { "x-captcha-response": token };
}

export function useAuthRetryAfter(initialSeconds = 0) {
	const [deadline, setDeadline] = useState(() =>
		initialSeconds > 0 ? Date.now() + Math.ceil(initialSeconds) * 1_000 : 0,
	);
	const [now, setNow] = useState(() => Date.now());
	const secondsRemaining = deadline > now ? Math.ceil((deadline - now) / 1_000) : 0;

	useEffect(() => {
		if (secondsRemaining <= 0) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [secondsRemaining]);

	return {
		secondsRemaining,
		start(error: unknown): boolean {
			const seconds = readCampusAuthRetryAfterSeconds(error);
			if (!seconds) {
				return false;
			}
			const currentTime = Date.now();
			setNow(currentTime);
			setDeadline(currentTime + seconds * 1_000);
			return true;
		},
	};
}

export function authRetryAfterMessage(secondsRemaining: number): string | undefined {
	return secondsRemaining > 0 ? `操作过于频繁，请在 ${secondsRemaining} 秒后重试。` : undefined;
}
