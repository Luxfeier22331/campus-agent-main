import { createDevDiningSeed, validateDiningDraft } from "@campus-agent/dining/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiningPage } from "../src/app/dining-page";

const overview = {
	draft: {
		baseReleaseId: "release-2",
		revision: 3,
		updatedAt: "2026-07-21T01:00:00.000Z",
		updatedBy: "ops@example.test",
	},
	publication: {
		catalogReleaseId: "release-2",
		reviewRevision: 2,
		updatedAt: "2026-07-21T01:00:00.000Z",
	},
	releases: 2,
	reviews: { blocked: 1, hidden: 0, published: 2 },
	source: { latestRunAt: null, pendingCatalogObservations: 0 },
};

const diningSeed = createDevDiningSeed();

const releases = [
	{
		createdAt: "2026-07-21T01:00:00.000Z",
		draftRevision: 2,
		notes: "第二次发布",
		releaseId: "release-2",
		rollbackOfReleaseId: null,
	},
	{
		createdAt: "2026-07-20T01:00:00.000Z",
		draftRevision: 1,
		notes: "第一次发布",
		releaseId: "release-1",
		rollbackOfReleaseId: null,
	},
];

const reviews = [
	{
		comment: "味道不错",
		contributorName: "用户一",
		dishName: "套餐一",
		moderationStatus: "safe",
		offeringId: "offering-1",
		rating: 5,
		reviewId: "review-1",
		stallName: "档口一",
		submittedAt: "2026-07-21T01:00:00.000Z",
		visibility: "published",
	},
	{
		comment: "分量足",
		contributorName: "用户二",
		dishName: "套餐二",
		moderationStatus: "safe",
		offeringId: "offering-2",
		rating: 4,
		reviewId: "review-2",
		stallName: "档口二",
		submittedAt: "2026-07-21T02:00:00.000Z",
		visibility: "published",
	},
];

describe("Dining page mutations", () => {
	it("locks every release rollback while one rollback and its refresh are pending", async () => {
		const write = deferredResponse();
		let rollbackCalls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = requestPath(input);
				if (path === "/api/ops/dining/overview") {
					return Response.json(overview);
				}
				if (path === "/api/ops/dining/releases") {
					return Response.json({ releases });
				}
				if (path === "/api/ops/dining/catalog/draft") {
					return Response.json({ draft: diningSeed.draft });
				}
				if (path === "/api/ops/dining/catalog/draft/validation") {
					return Response.json({ validation: validateDiningDraft(diningSeed.draft) });
				}
				if (path.includes("/api/ops/dining/releases/") && init?.method === "POST") {
					rollbackCalls += 1;
					return write.promise;
				}
				return Response.json({});
			}),
		);
		renderDiningPage();

		fireEvent.mouseDown(await screen.findByRole("tab", { name: "发布记录" }), {
			button: 0,
			ctrlKey: false,
		});
		const panel = await screen.findByRole("tabpanel", { name: "发布记录" });
		const notes = await within(panel).findAllByLabelText("回滚说明");
		for (const input of notes) {
			fireEvent.change(input, { target: { value: "撤销错误发布" } });
		}
		fireEvent.click(within(panel).getAllByRole("button", { name: "回滚" })[0]);

		await waitFor(() =>
			expect(within(panel).getByRole("button", { name: "回滚中" })).toBeDisabled(),
		);
		for (const button of within(panel).getAllByRole("button", { name: /回滚/u })) {
			expect(button).toBeDisabled();
		}
		expect(panel.querySelector("section[aria-busy='true']")).not.toBeNull();
		expect(rollbackCalls).toBe(1);

		write.resolve(Response.json({}));
		expect(await within(panel).findByText("发布 release-2 的回滚已提交。")).toBeInTheDocument();
	});

	it("locks every review command and attributes feedback to the submitted review", async () => {
		const write = deferredResponse();
		let commandCalls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = requestPath(input);
				if (path === "/api/ops/dining/overview") {
					return Response.json(overview);
				}
				if (path === "/api/ops/dining/reviews?limit=100") {
					return Response.json({ reviews });
				}
				if (path === "/api/ops/dining/catalog/draft") {
					return Response.json({ draft: diningSeed.draft });
				}
				if (path === "/api/ops/dining/catalog/draft/validation") {
					return Response.json({ validation: validateDiningDraft(diningSeed.draft) });
				}
				if (path.includes("/api/ops/dining/reviews/") && init?.method === "POST") {
					commandCalls += 1;
					return write.promise;
				}
				return Response.json({});
			}),
		);
		renderDiningPage();

		fireEvent.mouseDown(await screen.findByRole("tab", { name: "评价管理" }), {
			button: 0,
			ctrlKey: false,
		});
		const panel = await screen.findByRole("tabpanel", { name: "评价管理" });
		fireEvent.click((await within(panel).findAllByRole("button", { name: "隐藏" }))[0]);

		await waitFor(() =>
			expect(within(panel).getAllByRole("button", { name: "提交中" })).toHaveLength(3),
		);
		const actionButtons = within(panel)
			.getAllByRole("button")
			.filter((button) => /提交中|隐藏|重新绑定|复检/u.test(button.textContent ?? ""));
		expect(actionButtons).toHaveLength(6);
		for (const button of actionButtons) {
			expect(button).toBeDisabled();
		}
		expect(panel.querySelector("section[aria-busy='true']")).not.toBeNull();
		expect(commandCalls).toBe(1);

		write.resolve(Response.json({ ok: true }));
		expect(await within(panel).findByText("评价 review-1 的操作已提交。")).toBeInTheDocument();
	});

	it("locks every catalog write until the active write and refresh finish", async () => {
		const write = deferredResponse();
		let catalogWrites = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = requestPath(input);
				if (path === "/api/ops/dining/overview") {
					return Response.json(overview);
				}
				if (path === "/api/ops/dining/catalog/draft") {
					return Response.json({ draft: diningSeed.draft });
				}
				if (path === "/api/ops/dining/catalog/draft/validation") {
					return Response.json({ validation: validateDiningDraft(diningSeed.draft) });
				}
				if (path === "/api/ops/dining/catalog/draft/rebase" && init?.method === "POST") {
					catalogWrites += 1;
					return write.promise;
				}
				if (init?.method === "POST") {
					catalogWrites += 1;
				}
				return Response.json({ draft: diningSeed.draft });
			}),
		);
		renderDiningPage();

		fireEvent.change(await screen.findByLabelText("发布说明"), {
			target: { value: "发布说明" },
		});
		fireEvent.click(screen.getByRole("button", { name: "从采集记录重建草稿" }));

		const catalogPanel = screen.getByRole("tabpanel", { name: "目录草稿" });
		await waitFor(() =>
			expect(within(catalogPanel).getByRole("button", { name: "重建中" })).toBeDisabled(),
		);
		expect(catalogPanel.querySelector("section[aria-busy='true']")).not.toBeNull();
		expect(within(catalogPanel).getByRole("button", { name: "发布" })).toBeDisabled();
		for (const edit of within(catalogPanel).getAllByRole("button", { name: "编辑" })) {
			expect(edit).toBeDisabled();
		}
		fireEvent.click(within(catalogPanel).getByRole("button", { name: "发布" }));
		expect(catalogWrites).toBe(1);

		write.resolve(Response.json({ draft: diningSeed.draft }));
		await waitFor(() =>
			expect(
				within(catalogPanel).getByRole("button", { name: "从采集记录重建草稿" }),
			).toBeEnabled(),
		);
	});

	it("reports the page refresh while active queries are still updating", async () => {
		const refresh = deferredResponse();
		let overviewReads = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const path = requestPath(input);
				if (path === "/api/ops/dining/overview") {
					overviewReads += 1;
					return overviewReads === 1 ? Response.json(overview) : refresh.promise;
				}
				if (path === "/api/ops/dining/catalog/draft") {
					return Response.json({ draft: diningSeed.draft });
				}
				if (path === "/api/ops/dining/catalog/draft/validation") {
					return Response.json({ validation: validateDiningDraft(diningSeed.draft) });
				}
				return Response.json({});
			}),
		);
		renderDiningPage();

		fireEvent.click(await screen.findByRole("button", { name: "刷新" }));
		const button = await screen.findByRole("button", { name: "刷新中" });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute("aria-busy", "true");

		refresh.resolve(Response.json(overview));
		await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
	});
});

function renderDiningPage() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<DiningPage />
		</QueryClientProvider>,
	);
}

function requestPath(input: RequestInfo | URL) {
	const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const url = new URL(value, "https://ops.example.test");
	return `${url.pathname}${url.search}`;
}

function deferredResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
