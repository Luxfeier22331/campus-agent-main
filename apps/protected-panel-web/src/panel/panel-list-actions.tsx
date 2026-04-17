import { ExportButton, TopToolbar } from "react-admin";

import { PANEL_COPY } from "./panel-copy";

export function PanelListActions() {
  return (
    <TopToolbar>
      <ExportButton label={PANEL_COPY.actions.export} />
    </TopToolbar>
  );
}
