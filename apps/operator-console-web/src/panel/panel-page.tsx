import { Box, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export const PANEL_SURFACE_SX = {
	boxSizing: "border-box",
	maxWidth: "100%",
	minWidth: 0,
	overflowWrap: "break-word",
	width: "100%",
	"& .MuiBox-root, & .MuiCard-root, & .MuiCardContent-root, & .MuiPaper-root, & .MuiStack-root": {
		maxWidth: "100%",
		minWidth: 0,
	},
	"& .MuiAlert-message, & .MuiTypography-root": {
		overflowWrap: "anywhere",
	},
} satisfies SxProps<Theme>;

export const PANEL_PAGE_SX = {
	...PANEL_SURFACE_SX,
	p: { md: 3, xs: 2 },
} satisfies SxProps<Theme>;

export const PANEL_LIST_SX = {
	...PANEL_SURFACE_SX,
	"& .RaList-actions, & .RaList-content, & .RaList-main, & .RaList-root": {
		maxWidth: "100%",
		minWidth: 0,
	},
} satisfies SxProps<Theme>;

export function PanelPage(props: { children: ReactNode }) {
	return <Box sx={PANEL_PAGE_SX}>{props.children}</Box>;
}
