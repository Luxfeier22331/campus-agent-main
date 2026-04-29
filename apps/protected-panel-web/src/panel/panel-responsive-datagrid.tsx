import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

import { PANEL_COPY } from "./panel-copy";

export function PanelResponsiveDatagrid(props: { children: ReactNode; minWidth?: number }) {
	const minWidth = props.minWidth ?? 920;

	return (
		<Box
			sx={{
				maxWidth: "100%",
				minWidth: 0,
				width: "100%",
			}}
		>
			<Typography
				color="text.secondary"
				sx={{
					display: { sm: "none", xs: "block" },
					mb: 0.75,
				}}
				variant="caption"
			>
				{PANEL_COPY.table.horizontalScrollHint}
			</Typography>
			<Box
				sx={{
					maxWidth: "100%",
					minWidth: 0,
					overscrollBehaviorX: "contain",
					overflowX: "auto",
					scrollbarGutter: "stable",
					width: "100%",
					WebkitOverflowScrolling: "touch",
					"& .RaDatagrid-root": {
						minWidth,
					},
					"& .RaDatagrid-table": {
						tableLayout: "auto",
						minWidth,
					},
					"& .RaDatagrid-tableWrapper": {
						overflowX: "visible",
						width: "100%",
					},
					"& .MuiTableCell-root": {
						verticalAlign: "top",
						whiteSpace: "nowrap",
					},
					"& .MuiChip-root": {
						maxWidth: "100%",
					},
				}}
			>
				{props.children}
			</Box>
		</Box>
	);
}
