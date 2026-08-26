import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeInspector } from "../src/app/notices/notice-inspector";

describe("NoticeInspector", () => {
	it("shows the empty state when no notice is selected while the detail query is pending", () => {
		render(
			<NoticeInspector
				createJobError={null}
				currentNoticeJobs={[]}
				detailError={null}
				detailPending
				dirty={false}
				draftCategory=""
				isFamilyBusy={() => false}
				notice={null}
				onDraftCategory={() => undefined}
				onRetry={() => undefined}
				onSave={() => undefined}
				onStartJob={() => undefined}
				saveError={null}
				savePending={false}
				saveSucceeded={false}
				selectedNoticeId={null}
			/>,
		);

		expect(screen.getByText("选择一条通知")).toBeInTheDocument();
	});
});
