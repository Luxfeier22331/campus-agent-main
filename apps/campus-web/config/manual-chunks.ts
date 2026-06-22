const CHUNK_GROUPS = [
	{
		name: "markdown-vendor",
		patterns: [
			"/node_modules/@assistant-ui/react-markdown/",
			"/node_modules/@types/mdast/",
			"/node_modules/@types/unist/",
			"/node_modules/comma-separated-tokens/",
			"/node_modules/hast-util",
			"/node_modules/mdast-util",
			"/node_modules/micromark",
			"/node_modules/remark-",
			"/node_modules/remark/",
			"/node_modules/space-separated-tokens/",
			"/node_modules/trim-lines/",
			"/node_modules/trough/",
			"/node_modules/unified/",
			"/node_modules/unist-util",
			"/node_modules/vfile",
		],
	},
	{
		name: "assistant-ui-vendor",
		patterns: [
			"/node_modules/@assistant-ui/",
			"/node_modules/assistant-stream/",
			"/node_modules/@assistant-stream/",
		],
	},
	{
		name: "better-auth-ui-core-vendor",
		patterns: ["/node_modules/@better-auth-ui/core/", "/node_modules/@better-auth-ui/react/"],
	},
	{
		name: "better-auth-runtime-vendor",
		patterns: ["/node_modules/@better-auth/", "/node_modules/better-auth/"],
	},
	{
		name: "auth-transport-vendor",
		patterns: [
			"/node_modules/@marsidev/react-turnstile/",
			"/node_modules/better-call/",
			"/node_modules/bowser/",
		],
	},
	{
		name: "heroui-form-vendor",
		patterns: [
			"/node_modules/@heroui/react/dist/components/calendar",
			"/node_modules/@heroui/react/dist/components/calendar-year-picker",
			"/node_modules/@heroui/react/dist/components/combo-box",
			"/node_modules/@heroui/react/dist/components/date-field",
			"/node_modules/@heroui/react/dist/components/date-input-group",
			"/node_modules/@heroui/react/dist/components/date-picker",
			"/node_modules/@heroui/react/dist/components/input",
			"/node_modules/@heroui/react/dist/components/input-group",
			"/node_modules/@heroui/react/dist/components/list-box",
			"/node_modules/@heroui/react/dist/components/list-box-item",
			"/node_modules/@heroui/react/dist/components/list-box-section",
			"/node_modules/@heroui/react/dist/components/number-field",
			"/node_modules/@heroui/react/dist/components/select",
			"/node_modules/@heroui/react/dist/components/slider",
			"/node_modules/@heroui/react/dist/components/switch",
			"/node_modules/@heroui/react/dist/components/textfield",
			"/node_modules/@heroui/react/dist/components/textarea",
			"/node_modules/@heroui/react/dist/components/time-field",
			"/node_modules/input-otp/",
		],
	},
	{
		name: "heroui-react-vendor",
		patterns: ["/node_modules/@heroui/react/"],
	},
	{
		name: "heroui-styles-vendor",
		patterns: [
			"/node_modules/@heroui/styles/",
			"/node_modules/tailwind-merge/",
			"/node_modules/tailwind-variants/",
		],
	},
	{
		name: "gravity-icons-vendor",
		patterns: ["/node_modules/@gravity-ui/"],
	},
	{
		name: "react-aria-vendor",
		patterns: [
			"/node_modules/@internationalized/",
			"/node_modules/@react-aria/",
			"/node_modules/@react-stately/",
			"/node_modules/@react-types/",
			"/node_modules/react-aria-components/",
			"/node_modules/react-aria/",
			"/node_modules/react-stately/",
		],
	},
	{
		name: "radix-ui-vendor",
		patterns: ["/node_modules/@radix-ui/", "/node_modules/radix-ui/"],
	},
	{
		name: "react-vendor",
		patterns: ["/node_modules/react/", "/node_modules/react-dom/", "/node_modules/scheduler/"],
	},
	{
		name: "state-vendor",
		patterns: ["/node_modules/zustand/"],
	},
] as const;

export function campusWebManualChunks(id: string): string | undefined {
	if (!id.includes("/node_modules/")) {
		return;
	}

	for (const group of CHUNK_GROUPS) {
		if (group.patterns.some((pattern) => id.includes(pattern))) {
			return group.name;
		}
	}

	return;
}
