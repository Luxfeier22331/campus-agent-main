import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { readTimeSearch, replaceTimeQuery, type TimeSearch } from "../src/app/time-filters";
import { TimeRangeFilter } from "../src/app/ui/time-window-select";

it.each(["overview", "requests", "conversations", "accountEvents"] as const)(
	"provides the same seven choices in %s",
	(scope) => {
		const change = vi.fn();
		render(<TimeRangeFilter scope={scope} search={{}} onChange={change} />);
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
			"今日",
			"最近24h",
			"本周",
			"本月",
			"上月",
			"最近30d",
			"选择日期",
		]);
		expect(screen.getByLabelText("时间范围")).toHaveValue("today");
		fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "last-month" } });
		expect(change).toHaveBeenCalledWith({ window: "last-month" });
	},
);

describe("custom date input", () => {
	it("retains exact drilldown bounds until applying dates, validates spans, and clears pagination", () => {
		const change = vi.fn();
		const initial = {
			from: "2026-09-17T01:02:03.000Z",
			to: "2026-09-17T04:05:06.000Z",
			q: "question",
			cursor: "old",
			history: "older",
		};
		function Page() {
			const [search, setSearch] = useState<TimeSearch>(initial);
			return (
				<TimeRangeFilter
					scope="requests"
					search={search}
					onChange={(time) => {
						change(time);
						setSearch(replaceTimeQuery(initial, time));
					}}
				/>
			);
		}
		render(<Page />);
		expect(change).not.toHaveBeenCalled();
		expect(screen.getByLabelText("结束日期")).toHaveValue("2026-09-17");
		fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-01-01" } });
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-04-01" } });
		fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
		expect(screen.getByRole("alert")).toHaveTextContent("最多90天");
		expect(change).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-03-31" } });
		fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
		expect(change).toHaveBeenCalledWith({
			from: "2025-12-31T16:00:00.000Z",
			to: "2026-03-31T16:00:00.000Z",
		});
		expect(replaceTimeQuery(initial, { window: "today" })).toEqual({
			q: "question",
			window: "today",
		});
	});
	it("reports removed or malformed URL ranges instead of silently widening them", () => {
		expect(readTimeSearch({ window: "1h" }).timeError).toBeTruthy();
		expect(readTimeSearch({ from: "not-a-date" }).timeError).toBeTruthy();
		render(
			<TimeRangeFilter
				scope="overview"
				search={readTimeSearch({ from: "not-a-date" })}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole("alert")).toHaveTextContent("重新选择");
	});
});
