const DEFAULT_CHATKIT_RUNTIME_SCRIPT_URL = "/vendor/openai-chatkit/2026-06-17/chatkit.js";

export const CHATKIT_RUNTIME_SCRIPT_URL =
	import.meta.env.VITE_CHATKIT_RUNTIME_SCRIPT_URL?.trim() || DEFAULT_CHATKIT_RUNTIME_SCRIPT_URL;

const CHATKIT_RUNTIME_SCRIPT_SELECTOR = 'script[data-campus-chatkit-runtime="true"]';
const CHATKIT_RUNTIME_SCRIPT_STATE = "campusChatkitRuntimeState";

let chatKitRuntimePromise: Promise<void> | null = null;

export function loadChatKitRuntime(): Promise<void> {
	if (typeof document === "undefined") {
		return Promise.resolve();
	}
	if (chatKitRuntimePromise) {
		return chatKitRuntimePromise;
	}

	const existingScript = findChatKitRuntimeScript();
	if (existingScript?.dataset[CHATKIT_RUNTIME_SCRIPT_STATE] === "loaded") {
		return Promise.resolve();
	}

	chatKitRuntimePromise = new Promise<void>((resolve, reject) => {
		const script = existingScript ?? document.createElement("script");
		let settled = false;

		function resolveOnce() {
			if (settled) {
				return;
			}
			settled = true;
			script.dataset[CHATKIT_RUNTIME_SCRIPT_STATE] = "loaded";
			resolve();
		}

		function rejectOnce() {
			if (settled) {
				return;
			}
			settled = true;
			chatKitRuntimePromise = null;
			script.remove();
			reject(new Error(`ChatKit runtime script failed to load: ${CHATKIT_RUNTIME_SCRIPT_URL}`));
		}

		script.addEventListener("load", resolveOnce, { once: true });
		script.addEventListener("error", rejectOnce, { once: true });
		script.async = true;
		script.dataset.campusChatkitRuntime = "true";
		script.src = CHATKIT_RUNTIME_SCRIPT_URL;

		if (!existingScript) {
			document.head.appendChild(script);
		}
	});

	return chatKitRuntimePromise;
}

function findChatKitRuntimeScript(): HTMLScriptElement | null {
	const managedScript = document.querySelector<HTMLScriptElement>(CHATKIT_RUNTIME_SCRIPT_SELECTOR);
	if (managedScript) {
		return managedScript;
	}
	const resolvedScriptUrl = new URL(CHATKIT_RUNTIME_SCRIPT_URL, window.location.href).href;
	return Array.from(document.scripts).find((script) => script.src === resolvedScriptUrl) ?? null;
}
