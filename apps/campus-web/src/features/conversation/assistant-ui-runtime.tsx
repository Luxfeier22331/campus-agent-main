import { useExternalStoreRuntime } from "@assistant-ui/react";
import { useAssistantUiRunController } from "./use-assistant-ui-run-controller";

export function createCampusAssistantRuntimeHook(input: {
	loginRequired: boolean;
	onLoginRequired: () => void;
}) {
	return function useCampusAssistantExternalStoreRuntime() {
		return useExternalStoreRuntime(
			useAssistantUiRunController({
				loginRequired: input.loginRequired,
				onLoginRequired: input.onLoginRequired,
			}),
		);
	};
}
