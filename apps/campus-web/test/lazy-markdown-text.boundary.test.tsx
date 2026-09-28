import { render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownTextErrorBoundary } from "@/components/assistant-ui/lazy-markdown-text";

const Boom = ({ message }: { message: string }) => {
	throw new Error(message);
};

const Harness = ({ throwing }: { throwing: string }) => {
	const [resetKey, setResetKey] = useState(throwing);
	const [, setTick] = useState(0);
	return (
		<div>
			<MarkdownTextErrorBoundary resetKey={resetKey}>
				{resetKey === throwing ? (
					<Boom message={`render failed at ${throwing}`} />
				) : (
					<p>rendered {resetKey}</p>
				)}
			</MarkdownTextErrorBoundary>
			<button
				type="button"
				onClick={() => setResetKey(resetKey === "draft-1" ? "draft-2" : "draft-1")}
			>
				toggle key
			</button>
			<button type="button" onClick={() => setTick((tick) => tick + 1)}>
				rerender
			</button>
		</div>
	);
};

describe("MarkdownTextErrorBoundary", () => {
	it("renders fallback content when markdown rendering throws", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(
			<MarkdownTextErrorBoundary resetKey="draft-1">
				<Boom message="bad markdown" />
			</MarkdownTextErrorBoundary>,
		);

		expect(screen.getByText("回答内容渲染失败")).toBeInTheDocument();

		consoleError.mockRestore();
	});

	it("recovers when the resetKey changes after an error", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(<Harness throwing="draft-1" />);
		expect(screen.getByText("回答内容渲染失败")).toBeInTheDocument();

		await act(async () => {
			screen.getByRole("button", { name: "toggle key" }).click();
		});

		expect(screen.getByText("rendered draft-2")).toBeInTheDocument();

		consoleError.mockRestore();
	});

	it("stays on the fallback while re-rendering with the same resetKey", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(<Harness throwing="draft-1" />);
		expect(screen.getByText("回答内容渲染失败")).toBeInTheDocument();

		await act(async () => {
			screen.getByRole("button", { name: "rerender" }).click();
		});

		expect(screen.getByText("回答内容渲染失败")).toBeInTheDocument();

		consoleError.mockRestore();
	});
});
