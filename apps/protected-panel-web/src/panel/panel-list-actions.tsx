import { RefreshButton, TopToolbar } from "react-admin";

import { PANEL_COPY } from "./panel-copy";

export function PanelListActions() {
	return (
		<TopToolbar
			sx={{
				boxSizing: "border-box",
				display: { sm: "flex", xs: "none" },
				justifyContent: "flex-end",
				minHeight: { sm: 48, xs: 40 },
				px: 0,
				width: "100%",
			}}
		>
			<RefreshButton label={PANEL_COPY.actions.refreshList} />
		</TopToolbar>
	);
}
