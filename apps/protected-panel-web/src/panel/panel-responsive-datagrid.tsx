import { Box } from "@mui/material";
import type { ReactNode } from "react";

export function PanelResponsiveDatagrid(props: { children: ReactNode; minWidth?: number }) {
	return (
		<Box
			sx={{
				maxWidth: "100%",
				overflowX: "auto",
				"& .RaDatagrid-root": {
					minWidth: { md: "auto", xs: props.minWidth ?? 920 },
				},
				"& .RaDatagrid-table": {
					tableLayout: "auto",
				},
				"& .RaDatagrid-tableWrapper": {
					overflowX: "visible",
				},
				"& .MuiTableCell-root": {
					verticalAlign: "top",
					whiteSpace: "nowrap",
				},
			}}
		>
			{props.children}
		</Box>
	);
}
