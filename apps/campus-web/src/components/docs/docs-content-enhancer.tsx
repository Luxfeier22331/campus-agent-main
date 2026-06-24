import { useEffect } from "react";

const TABLE_CONTAINER_SELECTOR = ".docs-table-scroll, .rp-table-scroll-container";
const HEADER_ANCHOR_SELECTOR = ".rspress-doc a.rp-header-anchor, .rspress-doc a.header-anchor";
const ENHANCED_TABLE_ATTRIBUTE = "data-docs-enhanced-table";
const SCROLLABLE_TABLE_ATTRIBUTE = "data-docs-scrollable";
const MAX_MOBILE_CARD_ROWS = 8;
const MAX_MOBILE_CARD_COLUMNS = 5;

interface MobileTableRowPair {
	header: string;
	value: string;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function expandTable(table: HTMLTableElement): string[][] {
	const activeRowspans = new Map<number, { text: string; remaining: number }>();
	const rows: string[][] = [];

	for (const row of Array.from(table.rows)) {
		const expandedRow: string[] = [];
		let columnIndex = 0;

		const consumeActiveRowspans = () => {
			while (activeRowspans.has(columnIndex)) {
				const active = activeRowspans.get(columnIndex);
				if (!active) {
					break;
				}
				expandedRow.push(active.text);
				if (active.remaining <= 1) {
					activeRowspans.delete(columnIndex);
				} else {
					activeRowspans.set(columnIndex, {
						remaining: active.remaining - 1,
						text: active.text,
					});
				}
				columnIndex += 1;
			}
		};

		consumeActiveRowspans();
		for (const cell of Array.from(row.cells)) {
			consumeActiveRowspans();
			const text = normalizeText(cell.textContent);
			const colspan = Math.max(1, cell.colSpan);
			const rowspan = Math.max(1, cell.rowSpan);
			for (let offset = 0; offset < colspan; offset += 1) {
				expandedRow.push(text);
				if (rowspan > 1) {
					activeRowspans.set(columnIndex + offset, {
						remaining: rowspan - 1,
						text,
					});
				}
			}
			columnIndex += colspan;
		}
		while (expandedRow.length > 0 && !expandedRow.at(-1)) {
			expandedRow.pop();
		}
		if (expandedRow.some(Boolean)) {
			rows.push(expandedRow);
		}
	}

	return rows;
}

function buildMobileTableRowTitle(headers: string[], row: string[], rowIndex: number): string {
	const preferredHeaderPattern = /课程名称|课程名|项目|事项|环节|类别|模块|名称|要求|内容/;
	const preferredColumn = headers.findIndex((header) => preferredHeaderPattern.test(header));
	const preferredValue = normalizeText(row[preferredColumn]);
	if (preferredColumn >= 0 && /[\p{Script=Han}A-Za-z]/u.test(preferredValue)) {
		return preferredValue;
	}
	return (
		row
			.slice(0, 4)
			.map(normalizeText)
			.find((value) => /[\p{Script=Han}A-Za-z]/u.test(value)) ?? `第 ${rowIndex + 1} 行`
	);
}

function buildMobileTableRowPairs(headers: string[], row: string[]): MobileTableRowPair[] {
	const pairs: MobileTableRowPair[] = [];
	const seenPairs = new Set<string>();
	for (const [columnIndex, rawValue] of row.entries()) {
		const value = normalizeText(rawValue);
		const header = normalizeText(headers[columnIndex]) || "补充说明";
		if (!(value || header)) {
			continue;
		}
		const pairKey = `${header}\u0000${value}`;
		if (seenPairs.has(pairKey)) {
			continue;
		}
		seenPairs.add(pairKey);
		pairs.push({ header, value: value || "空" });
	}
	return pairs;
}

function buildMobileTableCards(table: HTMLTableElement): HTMLElement | null {
	const expandedRows = expandTable(table);
	if (expandedRows.length < 2 || (expandedRows[0]?.length ?? 0) < 2) {
		return null;
	}

	const headers = expandedRows[0] ?? [];
	const dataRows = expandedRows.slice(1).filter((row) => row.some(Boolean));
	if (dataRows.length === 0) {
		return null;
	}
	if (dataRows.length > MAX_MOBILE_CARD_ROWS || headers.length > MAX_MOBILE_CARD_COLUMNS) {
		return null;
	}

	const mobileCards = document.createElement("div");
	mobileCards.className = "docs-table-mobile-cards";
	mobileCards.setAttribute("aria-label", "表格移动端按行阅读");

	const list = document.createElement("div");
	list.className = "docs-table-mobile-card-list";
	for (const [rowIndex, row] of dataRows.entries()) {
		const card = document.createElement("article");
		card.className = "docs-table-mobile-card";

		const title = document.createElement("p");
		title.className = "docs-table-mobile-card-title";
		title.textContent = buildMobileTableRowTitle(headers, row, rowIndex);
		card.appendChild(title);

		const definitionList = document.createElement("dl");
		for (const { header, value } of buildMobileTableRowPairs(headers, row)) {
			const item = document.createElement("div");
			const term = document.createElement("dt");
			const description = document.createElement("dd");
			term.textContent = header;
			description.textContent = value;
			item.appendChild(term);
			item.appendChild(description);
			definitionList.appendChild(item);
		}
		card.appendChild(definitionList);
		list.appendChild(card);
	}
	mobileCards.appendChild(list);

	return mobileCards;
}

function enhanceTables(root: ParentNode = document): void {
	for (const container of Array.from(
		root.querySelectorAll<HTMLElement>(TABLE_CONTAINER_SELECTOR),
	)) {
		const table = container.querySelector<HTMLTableElement>("table");
		if (table) {
			container.setAttribute(
				SCROLLABLE_TABLE_ATTRIBUTE,
				table.getBoundingClientRect().width > container.clientWidth + 1 ? "true" : "false",
			);
		}
		if (container.getAttribute(ENHANCED_TABLE_ATTRIBUTE) === "true" || !table) {
			continue;
		}
		for (const cell of Array.from(table.rows[0]?.cells ?? [])) {
			cell.setAttribute("role", "columnheader");
		}
		const mobileCards = buildMobileTableCards(table);
		if (!mobileCards) {
			continue;
		}
		container.setAttribute(ENHANCED_TABLE_ATTRIBUTE, "true");
		if (table.parentElement === container) {
			container.insertBefore(mobileCards, table);
		} else {
			container.insertBefore(mobileCards, container.firstChild);
		}
	}
}

function enhanceHeaderAnchors(root: ParentNode = document): void {
	for (const anchor of Array.from(
		root.querySelectorAll<HTMLAnchorElement>(HEADER_ANCHOR_SELECTOR),
	)) {
		anchor.setAttribute("aria-hidden", "true");
		anchor.tabIndex = -1;
		if (normalizeText(anchor.textContent) === "#") {
			anchor.textContent = "";
		}
	}
}

function enhanceDocumentContent(): void {
	enhanceHeaderAnchors();
	enhanceTables();
}

export default function DocsContentEnhancer(): null {
	useEffect(() => {
		let frame = window.requestAnimationFrame(enhanceDocumentContent);
		const handleResize = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(enhanceDocumentContent);
		};
		const observer = new MutationObserver(handleResize);
		observer.observe(document.body, { childList: true, subtree: true });
		window.addEventListener("resize", handleResize);
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener("resize", handleResize);
		};
	}, []);

	return null;
}
