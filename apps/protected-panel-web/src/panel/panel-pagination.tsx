import {
	Box,
	Pagination,
	TablePagination,
	type TablePaginationProps,
	Toolbar,
	useMediaQuery,
} from "@mui/material";
import { useCallback, useMemo } from "react";
import { useListPaginationContext } from "react-admin";

import {
	formatPanelPageOutOfBoundaries,
	formatPanelPaginationAriaLabel,
	formatPanelPaginationDisplayedRows,
	PANEL_COPY,
} from "./panel-copy";

const PANEL_ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100];

type TablePageChangeHandler = NonNullable<TablePaginationProps["onPageChange"]>;
type RowsPerPageChangeHandler = NonNullable<TablePaginationProps["onRowsPerPageChange"]>;

interface PanelPaginationActionsProps {
	count: number;
	onPageChange: TablePageChangeHandler;
	page: number;
	rowsPerPage: number;
}

function PanelPaginationActions({
	count,
	onPageChange,
	page,
	rowsPerPage,
}: PanelPaginationActionsProps) {
	const totalPages = Math.ceil(count / rowsPerPage) || 1;

	if (totalPages <= 1) {
		return <Box sx={{ flexShrink: 0, ml: 0.5 }} />;
	}

	return (
		<Box sx={{ flexShrink: 0, ml: 0.5 }}>
			<Pagination
				count={totalPages}
				getItemAriaLabel={(type, targetPage, selected) =>
					formatPanelPaginationAriaLabel({
						page: targetPage ?? undefined,
						selected,
						type,
					})
				}
				onChange={(event, targetPage) => {
					onPageChange(event as never, targetPage - 1);
				}}
				page={page + 1}
				shape="rounded"
				size="small"
			/>
		</Box>
	);
}

export function PanelPagination() {
	const { hasNextPage, isPending, page, perPage, setPage, setPerPage, total } =
		useListPaginationContext();
	const isSmall = useMediaQuery((theme: { breakpoints: { down: (key: string) => string } }) =>
		theme.breakpoints.down("md"),
	);
	const totalPages = useMemo(() => {
		return total != null ? Math.ceil(total / perPage) : undefined;
	}, [perPage, total]);

	const handlePageChange = useCallback<TablePageChangeHandler>(
		(event, nextPage) => {
			event?.stopPropagation();

			if (nextPage < 0 || (totalPages && nextPage > totalPages - 1)) {
				throw new Error(formatPanelPageOutOfBoundaries(nextPage + 1));
			}

			setPage(nextPage + 1);
		},
		[setPage, totalPages],
	);

	const handlePerPageChange = useCallback<RowsPerPageChangeHandler>(
		(event) => {
			setPerPage(Number.parseInt(event.target.value, 10));
		},
		[setPerPage],
	);

	if (isPending) {
		return <Toolbar variant="dense" />;
	}

	if (total === 0 || page < 1 || (total != null && totalPages != null && page > totalPages)) {
		return null;
	}

	const labelDisplayedRows = ({ count, from, to }: { count: number; from: number; to: number }) =>
		formatPanelPaginationDisplayedRows({
			count,
			from,
			hasNextPage: Boolean(hasNextPage),
			to,
		});

	if (isSmall) {
		return (
			<TablePagination
				component="span"
				count={total ?? -1}
				getItemAriaLabel={(type) => formatPanelPaginationAriaLabel({ type })}
				labelDisplayedRows={labelDisplayedRows}
				labelRowsPerPage={PANEL_COPY.pagination.rowsPerPage}
				nextIconButtonProps={{
					disabled: !hasNextPage,
				}}
				onPageChange={handlePageChange}
				page={page - 1}
				rowsPerPage={perPage}
				rowsPerPageOptions={[]}
			/>
		);
	}

	return (
		<TablePagination
			ActionsComponent={total != null ? PanelPaginationActions : undefined}
			backIconButtonProps={{
				disabled: page <= 1,
			}}
			component="span"
			count={total ?? -1}
			getItemAriaLabel={(type) => formatPanelPaginationAriaLabel({ type })}
			labelDisplayedRows={labelDisplayedRows}
			labelRowsPerPage={PANEL_COPY.pagination.rowsPerPage}
			nextIconButtonProps={{
				disabled: !hasNextPage,
			}}
			onPageChange={handlePageChange}
			onRowsPerPageChange={handlePerPageChange}
			page={page - 1}
			rowsPerPage={perPage}
			rowsPerPageOptions={PANEL_ROWS_PER_PAGE_OPTIONS}
		/>
	);
}
