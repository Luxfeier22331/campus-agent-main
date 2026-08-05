import { cn } from "@campus-agent/ui";
import {
	type ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";

interface DataTableColumn<T> {
	cell: (row: T) => React.ReactNode;
	cellClassName?: string;
	header: string;
	headerClassName?: string;
	id?: string;
	rowHeader?: boolean;
	stickyRight?: boolean;
}

export function DataTable<T>({
	busy = false,
	caption,
	columns,
	data,
	emptyMessage = "没有数据。",
	minWidth = "760px",
	rowKey,
	stickyFirstColumn = false,
	stickyLastColumn = false,
	tableClassName,
}: {
	busy?: boolean;
	caption?: string;
	columns: DataTableColumn<T>[];
	data: T[];
	emptyMessage?: string;
	minWidth?: string;
	rowKey: (row: T) => string;
	stickyFirstColumn?: boolean;
	stickyLastColumn?: boolean;
	tableClassName?: string;
}) {
	const rowHeaderCount = columns.filter((column) => column.rowHeader).length;
	if (rowHeaderCount !== 1) {
		throw new Error(
			`DataTable requires exactly one row header column; received ${rowHeaderCount}.`,
		);
	}
	const columnHelper = createColumnHelper<T>();
	const tableColumns = columns.map((column) =>
		columnHelper.display({
			cell: (info) => column.cell(info.row.original),
			header: column.header,
			id: column.id ?? column.header,
		}),
	) as ColumnDef<T>[];
	const columnById = new Map(columns.map((column) => [column.id ?? column.header, column]));
	const table = useReactTable({
		columns: tableColumns,
		data,
		getCoreRowModel: getCoreRowModel(),
		getRowId: rowKey,
	});
	const rows = table.getRowModel().rows;
	const pinBothEdges = stickyFirstColumn && stickyLastColumn;

	return (
		<div
			aria-busy={busy}
			className={cn(
				"min-w-0 w-full max-w-full border-border border-y bg-background transition-opacity",
				busy && "opacity-60",
			)}
		>
			<div className="overflow-x-auto overscroll-x-contain">
				<div style={{ minWidth }}>
					<table
						aria-label={caption}
						className={cn("w-full table-auto border-collapse text-left text-sm", tableClassName)}
					>
						{caption ? <caption className="sr-only">{caption}</caption> : null}
						<thead>
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header, index) => {
										const column = columnById.get(header.column.id);
										return (
											<th
												className={cn(
													"border-border border-b bg-secondary px-3 py-2 font-semibold text-muted-foreground text-xs",
													column?.headerClassName,
													stickyFirstColumn &&
														index === 0 &&
														(pinBothEdges
															? "md:sticky md:left-0 md:z-20 md:border-r"
															: "sticky left-0 z-20 border-r"),
													column?.stickyRight ||
														(stickyLastColumn &&
															index === headerGroup.headers.length - 1 &&
															(pinBothEdges
																? "md:sticky md:right-0 md:z-20 md:border-l"
																: "sticky right-0 z-20 border-l")),
												)}
												key={header.id}
												scope="col"
											>
												{header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext())}
											</th>
										);
									})}
								</tr>
							))}
						</thead>
						<tbody>
							{rows.length > 0 ? (
								rows.map((row) => (
									<DataTableRow
										columnById={columnById}
										columns={columns}
										key={row.id}
										row={row}
										stickyFirstColumn={stickyFirstColumn}
										stickyLastColumn={stickyLastColumn}
										pinBothEdges={pinBothEdges}
									/>
								))
							) : (
								<tr>
									<td
										className="px-3 py-8 text-center text-muted-foreground"
										colSpan={columns.length}
									>
										{emptyMessage}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function DataTableRow<T>({
	columnById,
	columns,
	row,
	stickyFirstColumn,
	stickyLastColumn,
	pinBothEdges,
}: {
	columnById: Map<string, DataTableColumn<T>>;
	columns: DataTableColumn<T>[];
	row: ReturnType<ReturnType<typeof useReactTable<T>>["getRowModel"]>["rows"][number];
	stickyFirstColumn: boolean;
	stickyLastColumn: boolean;
	pinBothEdges: boolean;
}) {
	const cells = row.getVisibleCells();
	return (
		<tr className="group border-border border-b transition-colors last:border-b-0 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60">
			{cells.map((cell, index) => {
				const column = columnById.get(cell.column.id);
				const content = flexRender(cell.column.columnDef.cell, cell.getContext());
				const stickyClass = cn(
					stickyFirstColumn &&
						index === 0 &&
						(pinBothEdges
							? "md:sticky md:left-0 md:z-10 md:border-r md:bg-background md:group-hover:bg-surface-muted"
							: "sticky left-0 z-10 border-r bg-background group-hover:bg-surface-muted"),
					column?.stickyRight ||
						(stickyLastColumn &&
							index === cells.length - 1 &&
							(pinBothEdges
								? "md:sticky md:right-0 md:z-10 md:border-l md:bg-background md:group-hover:bg-surface-muted"
								: "sticky right-0 z-10 border-l bg-background group-hover:bg-surface-muted")),
				);
				return columns[index]?.rowHeader ? (
					<th
						className={cn(
							"break-words px-3 py-3 text-left font-medium align-top",
							column?.cellClassName,
							stickyClass,
						)}
						key={cell.id}
						scope="row"
					>
						{content}
					</th>
				) : (
					<td
						className={cn("break-words px-3 py-3 align-top", column?.cellClassName, stickyClass)}
						key={cell.id}
					>
						{content}
					</td>
				);
			})}
		</tr>
	);
}
