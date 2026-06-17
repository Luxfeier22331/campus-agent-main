import { createTheme } from "@mui/material/styles";

export const operatorConsoleTheme = createTheme({
	palette: {
		background: {
			default: "#f6f7f9",
			paper: "#ffffff",
		},
		divider: "#d8dee6",
		error: {
			main: "#b42318",
		},
		info: {
			main: "#256f8f",
		},
		primary: {
			main: "#23626f",
		},
		secondary: {
			main: "#7a4e15",
		},
		success: {
			main: "#2e7d32",
		},
		text: {
			primary: "#17202c",
			secondary: "#5d6979",
		},
		warning: {
			main: "#a05a00",
		},
	},
	shape: {
		borderRadius: 8,
	},
	typography: {
		fontFamily:
			'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		h4: {
			fontSize: "1.625rem",
			fontWeight: 700,
			lineHeight: 1.25,
		},
		h5: {
			fontSize: "1.25rem",
			fontWeight: 700,
			lineHeight: 1.3,
		},
		h6: {
			fontSize: "1rem",
			fontWeight: 700,
			lineHeight: 1.35,
		},
	},
	components: {
		MuiAlert: {
			styleOverrides: {
				root: {
					borderRadius: 8,
				},
			},
		},
		MuiAppBar: {
			styleOverrides: {
				root: {
					backgroundImage: "none",
					borderBottom: "1px solid #d8dee6",
					boxShadow: "0 1px 2px rgba(23, 32, 44, 0.08)",
				},
			},
		},
		MuiButton: {
			styleOverrides: {
				root: {
					borderRadius: 6,
					textTransform: "none",
				},
			},
		},
		MuiCard: {
			defaultProps: {
				variant: "outlined",
			},
			styleOverrides: {
				root: {
					backgroundImage: "none",
					boxShadow: "none",
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: {
					borderRadius: 999,
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				head: {
					color: "#17202c",
					fontWeight: 700,
				},
			},
		},
	},
});
