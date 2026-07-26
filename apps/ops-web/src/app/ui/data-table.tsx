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
	header: string;
	rowHeader?: boolean;
}

export function DataTable<T>({
	caption,
	columns,
	data,
	minWidth = "760px",
	rowKey,
	stickyFirstColumn = false,
	stickyLastColumn = false,
}: {
	caption?: string;
	columns: DataTableColumn<T>[];
	data: T[];
	minWidth?: string;
	rowKey: (row: T) => string;
	stickyFirstColumn?: boolean;
	stickyLastColumn?: boolean;
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
			id: column.header,
		}),
	) as ColumnDef<T>[];
	const table = useReactTable({
		columns: tableColumns,
		data,
		getCoreRowModel: getCoreRowModel(),
		getRowId: rowKey,
	});
	const rows = table.getRowModel().rows;

	return (
		<div className="min-w-0 w-full max-w-full border-border border-y bg-background">
			<div className="overflow-x-auto overscroll-x-contain">
				<div style={{ minWidth }}>
					<table
						aria-label={caption}
						className="w-full table-auto border-collapse text-left text-sm"
					>
						{caption ? <caption className="sr-only">{caption}</caption> : null}
						<thead>
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header, index) => (
										<th
											className={cn(
												"border-border border-b bg-secondary px-3 py-2 font-semibold text-muted-foreground text-xs",
												stickyFirstColumn && index === 0 && "sticky left-0 z-20 border-r",
												stickyLastColumn &&
													index === headerGroup.headers.length - 1 &&
													"sticky right-0 z-20 border-l",
											)}
											key={header.id}
											scope="col"
										>
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
										</th>
									))}
								</tr>
							))}
						</thead>
						<tbody>
							{rows.map((row) => (
								<DataTableRow
									columns={columns}
									key={row.id}
									row={row}
									stickyFirstColumn={stickyFirstColumn}
									stickyLastColumn={stickyLastColumn}
								/>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function DataTableRow<T>({
	columns,
	row,
	stickyFirstColumn,
	stickyLastColumn,
}: {
	columns: DataTableColumn<T>[];
	row: ReturnType<ReturnType<typeof useReactTable<T>>["getRowModel"]>["rows"][number];
	stickyFirstColumn: boolean;
	stickyLastColumn: boolean;
}) {
	const cells = row.getVisibleCells();
	return (
		<tr className="group border-border border-b transition-colors last:border-b-0 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60">
			{cells.map((cell, index) => {
				const content = flexRender(cell.column.columnDef.cell, cell.getContext());
				const stickyClass = cn(
					stickyFirstColumn &&
						index === 0 &&
						"sticky left-0 z-10 border-r bg-background group-hover:bg-surface-muted",
					stickyLastColumn &&
						index === cells.length - 1 &&
						"sticky right-0 z-10 border-l bg-background group-hover:bg-surface-muted",
				);
				return columns[index]?.rowHeader ? (
					<th
						className={cn("break-words px-3 py-3 text-left font-medium align-top", stickyClass)}
						key={cell.id}
						scope="row"
					>
						{content}
					</th>
				) : (
					<td className={cn("break-words px-3 py-3 align-top", stickyClass)} key={cell.id}>
						{content}
					</td>
				);
			})}
		</tr>
	);
}
