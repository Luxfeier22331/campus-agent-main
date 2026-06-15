const CHUNK_GROUPS = [
	{
		name: "react-admin-entry",
		patterns: [
			"/node_modules/react-admin/",
			"/node_modules/ra-i18n-",
			"/node_modules/ra-language-",
		],
	},
	{
		name: "ra-core-vendor",
		patterns: [
			"/node_modules/ra-core/",
			"/node_modules/@tanstack/query-core/",
			"/node_modules/@tanstack/react-query/",
			"/node_modules/react-hook-form/",
		],
	},
	{
		name: "ra-ui-vendor",
		patterns: ["/node_modules/ra-ui-materialui/"],
	},
	{
		name: "mui-icons-vendor",
		patterns: ["/node_modules/@mui/icons-material/"],
	},
	{
		name: "mui-x-vendor",
		patterns: ["/node_modules/@mui/x-"],
	},
	{
		name: "mui-material-vendor",
		patterns: ["/node_modules/@mui/material/"],
	},
	{
		name: "mui-system-vendor",
		patterns: [
			"/node_modules/@emotion/",
			"/node_modules/@mui/private-theming/",
			"/node_modules/@mui/styled-engine/",
			"/node_modules/@mui/system/",
			"/node_modules/@mui/utils/",
			"/node_modules/stylis/",
		],
	},
	{
		name: "react-vendor",
		patterns: [
			"/node_modules/react/",
			"/node_modules/react-dom/",
			"/node_modules/react-router/",
			"/node_modules/react-router-dom/",
			"/node_modules/scheduler/",
		],
	},
] as const;

export function operatorConsoleManualChunks(id: string): string | undefined {
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
