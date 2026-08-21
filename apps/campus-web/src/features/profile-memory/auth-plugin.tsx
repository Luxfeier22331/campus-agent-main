import { createAuthPlugin } from "@better-auth-ui/core";
import { Brain } from "lucide-react";

import { ProfileMemorySettings } from "./profile-memory-settings";

declare module "@better-auth-ui/core" {
	interface SettingsViewPaths {
		memory: string;
	}
}

export const profileMemoryPlugin = createAuthPlugin("profile-memory", () => ({
	settingsTabs: [
		{
			component: ProfileMemorySettings,
			label: (
				<>
					<Brain aria-hidden />
					记忆
				</>
			),
			view: "memory" as const,
		},
	],
	viewPaths: {
		settings: {
			memory: "memory",
		},
	},
}));
