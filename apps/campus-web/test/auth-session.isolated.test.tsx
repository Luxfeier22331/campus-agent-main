import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authQuery = vi.hoisted(() => ({
	data: null as null | { session: { id: string }; user: { id: string } },
	error: null as Error | null,
	isPending: true,
	isRefetching: false,
	refetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/platform/auth/client", () => ({
	campusAuthClient: { useSession: () => authQuery },
}));

import { CampusSessionProvider, useCampusSession } from "../src/platform/auth/session";

function SessionProbe() {
	const session = useCampusSession();
	return <output>{session.status}</output>;
}

describe("campus session provider", () => {
	beforeEach(() => {
		authQuery.data = null;
		authQuery.error = null;
		authQuery.isPending = true;
		authQuery.isRefetching = false;
	});

	it("distinguishes loading, anonymous, unavailable, and authenticated states", () => {
		const view = render(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);
		expect(screen.getByText("loading")).toBeVisible();

		authQuery.isPending = false;
		view.rerender(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);
		expect(screen.getByText("anonymous")).toBeVisible();

		authQuery.error = new Error("503 dependency_not_ready");
		view.rerender(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);
		expect(screen.getByText("unavailable")).toBeVisible();

		authQuery.data = { session: { id: "session-1" }, user: { id: "user-1" } };
		view.rerender(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);
		// A transient error must not kick a user with cached session data out of the app.
		expect(screen.getByText("authenticated")).toBeVisible();

		authQuery.error = null;
		view.rerender(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);
		expect(screen.getByText("authenticated")).toBeVisible();
	});

	it("treats an unauthorized session response as anonymous after sign-out", () => {
		const view = render(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);

		authQuery.isPending = false;
		authQuery.error = Object.assign(new Error("Unauthorized"), { status: 401 });
		view.rerender(
			<CampusSessionProvider>
				<SessionProbe />
			</CampusSessionProvider>,
		);

		expect(screen.getByText("anonymous")).toBeVisible();
	});
});
