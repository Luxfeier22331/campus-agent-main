import ViewWeekOutlinedIcon from "@mui/icons-material/ViewWeekOutlined";
import { Box, Button, Checkbox, FormControlLabel, Popover, Stack, Typography } from "@mui/material";
import { type MouseEvent, useMemo, useState } from "react";
import { useResourceContext, useStore } from "react-admin";

import { PANEL_COPY } from "../panel-copy";

interface ConfigurableDatagridColumn {
	index: string;
	label?: string;
	source?: string;
}

export function RequestColumnSettingsButton({
	preferenceKey,
	resource,
}: {
	preferenceKey: string;
	resource?: string;
}) {
	const resolvedResource = useResourceContext({ resource });
	const finalPreferenceKey = preferenceKey || `${resolvedResource}.datagrid`;
	const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
	const [availableColumns] = useStore<ConfigurableDatagridColumn[]>(
		`preferences.${finalPreferenceKey}.availableColumns`,
		[],
	);
	const [omit] = useStore<string[]>(`preferences.${finalPreferenceKey}.omit`, []);
	const [storedColumns, setStoredColumns] = useStore<string[]>(
		`preferences.${finalPreferenceKey}.columns`,
		[],
	);

	const configurableColumns = useMemo(
		() => availableColumns.filter((column) => typeof column.source === "string" && column.source),
		[availableColumns],
	);
	const defaultColumns = useMemo(
		() =>
			configurableColumns
				.filter((column) => (column.source ? !omit.includes(column.source) : true))
				.map((column) => column.index),
		[configurableColumns, omit],
	);
	const columns = storedColumns.length > 0 ? storedColumns : defaultColumns;

	function handleOpen(event: MouseEvent<HTMLButtonElement>) {
		setAnchorEl(event.currentTarget);
	}

	function handleClose() {
		setAnchorEl(null);
	}

	function handleToggle(targetIndex: string, checked: boolean) {
		if (checked) {
			setStoredColumns(
				configurableColumns
					.filter((column) => column.index === targetIndex || columns.includes(column.index))
					.map((column) => column.index),
			);
			return;
		}

		setStoredColumns(columns.filter((index) => index !== targetIndex));
	}

	return (
		<>
			<Button
				aria-label={PANEL_COPY.actions.columnSettings}
				color="primary"
				onClick={handleOpen}
				size="small"
				startIcon={<ViewWeekOutlinedIcon />}
				variant="outlined"
			>
				{PANEL_COPY.actions.columnSettings}
			</Button>
			<Popover
				anchorEl={anchorEl}
				anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
				onClose={handleClose}
				open={Boolean(anchorEl)}
				transformOrigin={{ horizontal: "center", vertical: "top" }}
			>
				<Box sx={{ minWidth: 260, p: 2 }}>
					<Stack spacing={1.5}>
						<Typography fontWeight={600} variant="subtitle2">
							{PANEL_COPY.actions.columnSettings}
						</Typography>
						<Stack spacing={0.5}>
							{configurableColumns.map((column) => {
								const label = column.label || column.source || column.index;
								return (
									<FormControlLabel
										control={
											<Checkbox
												checked={columns.includes(column.index)}
												onChange={(event) => handleToggle(column.index, event.target.checked)}
												size="small"
											/>
										}
										key={column.index}
										label={label}
										sx={{ m: 0 }}
									/>
								);
							})}
						</Stack>
					</Stack>
				</Box>
			</Popover>
		</>
	);
}
