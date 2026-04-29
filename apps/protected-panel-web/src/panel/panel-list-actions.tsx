import { RefreshButton, TopToolbar } from "react-admin";

import { PANEL_COPY } from "./panel-copy";

export function PanelListActions() {
	return (
		<TopToolbar>
			<RefreshButton label={PANEL_COPY.actions.refreshList} />
		</TopToolbar>
	);
}
