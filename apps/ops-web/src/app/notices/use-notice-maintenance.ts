import {
	keepPreviousData,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import type { NoticeCategory } from "campus-contracts/notices";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoticeJob, NoticeJobCreate, NoticeState } from "../../shared/ops-contract";
import {
	createNoticeJob,
	fetchNotice,
	fetchNoticeJobs,
	fetchNotices,
	updateNoticeCategory,
} from "../ops-api/notices";
import {
	isActiveNoticeJob,
	isBatchNoticeJob,
	isTerminalNoticeJob,
	type NoticeJobFamily,
	noticeJobFamily,
} from "./notice-status";

export const noticesQueryKey = ["notices"] as const;
export const noticeQueryKey = ["notice"] as const;
export const noticeJobsQueryKey = ["notice-jobs"] as const;
export const noticeJobCreateMutationKey = ["notice-job-create"] as const;

export interface NoticeMaintenanceFilters {
	category: NoticeCategory | "";
	page: number;
	q: string;
	state: NoticeState | "";
}

export type NoticeNavigationIntent =
	| { kind: "close" }
	| {
			category: NoticeCategory | "";
			kind: "filters";
			page: number;
			q: string;
			state: NoticeState | "";
	  }
	| { kind: "select"; noticeId: number };

export function useNoticeMaintenance() {
	const queryClient = useQueryClient();
	const [category, setCategory] = useState<NoticeCategory | "">("");
	const [page, setPage] = useState(1);
	const [q, setQ] = useState("");
	const [search, setSearch] = useState("");
	const [selectedNoticeId, setSelectedNoticeId] = useState<number | null>(null);
	const [state, setState] = useState<NoticeState | "">("");
	const [draftNoticeId, setDraftNoticeId] = useState<number | null>(null);
	const [draftCategory, setDraftCategory] = useState<NoticeCategory | "">("");
	const [pendingIntent, setPendingIntent] = useState<NoticeNavigationIntent | null>(null);
	const [taskCenterOpen, setTaskCenterOpen] = useState(false);
	const previousJobStatuses = useRef(new Map<string, NoticeJob["status"]>());

	const filters = useMemo<NoticeMaintenanceFilters>(
		() => ({ category, page, q, state }),
		[category, page, q, state],
	);
	const notices = useQuery({
		queryFn: ({ signal }) =>
			fetchNotices({
				...(category ? { category } : {}),
				page,
				...(q ? { q } : {}),
				signal,
				...(state ? { state } : {}),
			}),
		placeholderData: keepPreviousData,
		queryKey: [...noticesQueryKey, filters],
	});
	const detail = useQuery({
		enabled: selectedNoticeId !== null,
		queryFn: ({ signal }) => fetchNotice(selectedNoticeId as number, { signal }),
		queryKey: [...noticeQueryKey, selectedNoticeId],
	});
	const jobs = useQuery({
		queryFn: ({ signal }) => fetchNoticeJobs({ signal }),
		queryKey: noticeJobsQueryKey,
		refetchInterval: (query) => (query.state.data?.jobs.some(isActiveNoticeJob) ? 3_000 : false),
	});

	const saveCategory = useMutation({
		mutationFn: updateNoticeCategory,
		onSuccess: async (result) => {
			queryClient.setQueryData([...noticeQueryKey, result.notice.noticeId], result);
			setDraftCategory(result.notice.category ?? "");
			await queryClient.invalidateQueries({ queryKey: noticesQueryKey });
		},
	});

	const createJob = useMutation({
		mutationKey: noticeJobCreateMutationKey,
		mutationFn: createNoticeJob,
		onSuccess: async ({ job }) => {
			previousJobStatuses.current.set(job.jobName, job.status);
			await queryClient.invalidateQueries({ queryKey: noticeJobsQueryKey });
		},
	});
	const pendingJobInputs = useMutationState({
		filters: { mutationKey: noticeJobCreateMutationKey, status: "pending" },
		select: (mutation) => mutation.state.variables as NoticeJobCreate,
	});
	const startJob = useCallback(
		(input: NoticeJobCreate) => {
			createJob.mutate(input);
		},
		[createJob],
	);

	const selectedListNotice = notices.data?.items.find(
		(notice) => notice.noticeId === selectedNoticeId,
	);
	const selectedNotice = detail.data?.notice ?? selectedListNotice ?? null;
	const dirty = Boolean(
		detail.data?.notice &&
			draftNoticeId === detail.data.notice.noticeId &&
			draftCategory !== (detail.data.notice.category ?? ""),
	);

	useEffect(() => {
		if (selectedNoticeId === null) {
			setDraftNoticeId(null);
			setDraftCategory("");
			return;
		}
		const nextNotice = detail.data?.notice;
		if (nextNotice?.noticeId === selectedNoticeId && draftNoticeId !== selectedNoticeId) {
			setDraftNoticeId(selectedNoticeId);
			setDraftCategory(nextNotice.category ?? "");
		}
	}, [detail.data?.notice, draftNoticeId, selectedNoticeId]);

	useEffect(() => {
		if (!jobs.data) {
			return;
		}
		const detailNoticeIds = new Set<number>();
		let noticeDataChanged = false;
		const nextJobStatuses = new Map<string, NoticeJob["status"]>();
		for (const job of jobs.data.jobs) {
			const previousStatus = previousJobStatuses.current.get(job.jobName);
			if (
				previousStatus &&
				isActiveNoticeJob({ status: previousStatus }) &&
				isTerminalNoticeJob(job)
			) {
				noticeDataChanged = true;
				if (job.noticeId !== null) {
					detailNoticeIds.add(job.noticeId);
				} else if (isBatchNoticeJob(job) && selectedNoticeId !== null) {
					detailNoticeIds.add(selectedNoticeId);
				}
			}
			nextJobStatuses.set(job.jobName, job.status);
		}
		previousJobStatuses.current = nextJobStatuses;
		if (!noticeDataChanged) {
			return;
		}
		const invalidations = [
			queryClient.invalidateQueries({ queryKey: noticesQueryKey }),
			...[...detailNoticeIds].map((noticeId) =>
				queryClient.invalidateQueries({ queryKey: [...noticeQueryKey, noticeId] }),
			),
		];
		void Promise.all(invalidations);
	}, [jobs.data, queryClient, selectedNoticeId]);

	const applyIntent = useCallback(
		(intent: NoticeNavigationIntent) => {
			saveCategory.reset();
			if (intent.kind === "close") {
				setSelectedNoticeId(null);
				return;
			}
			if (intent.kind === "select") {
				setSelectedNoticeId(intent.noticeId);
				return;
			}
			setCategory(intent.category);
			setPage(intent.page);
			setQ(intent.q);
			setSearch(intent.q);
			setState(intent.state);
		},
		[saveCategory],
	);

	const requestIntent = useCallback(
		(intent: NoticeNavigationIntent) => {
			if (dirty) {
				setPendingIntent(intent);
				return;
			}
			applyIntent(intent);
		},
		[applyIntent, dirty],
	);

	const requestSelectNotice = useCallback(
		(noticeId: number) => {
			if (noticeId === selectedNoticeId) {
				return;
			}
			requestIntent({ kind: "select", noticeId });
		},
		[requestIntent, selectedNoticeId],
	);

	const requestCloseNotice = useCallback(() => {
		if (selectedNoticeId !== null) {
			requestIntent({ kind: "close" });
		}
	}, [requestIntent, selectedNoticeId]);

	const requestFilters = useCallback(
		(next: Partial<NoticeMaintenanceFilters>) => {
			requestIntent({
				category: next.category ?? category,
				kind: "filters",
				page: next.page ?? page,
				q: next.q ?? q,
				state: next.state ?? state,
			});
		},
		[category, page, q, requestIntent, state],
	);

	const requestSearch = useCallback(
		(nextSearch: string) => {
			requestFilters({ page: 1, q: nextSearch.trim() });
		},
		[requestFilters],
	);

	const requestPage = useCallback(
		(nextPage: number) => {
			requestFilters({ page: nextPage });
		},
		[requestFilters],
	);

	const saveDraft = useCallback(async () => {
		const notice = detail.data?.notice;
		if (!(notice && draftCategory) || draftCategory === notice.category) {
			return true;
		}
		await saveCategory.mutateAsync({ category: draftCategory, noticeId: notice.noticeId });
		return true;
	}, [detail.data?.notice, draftCategory, saveCategory]);

	const discardPendingIntent = useCallback(() => {
		setDraftCategory(detail.data?.notice?.category ?? "");
		const intent = pendingIntent;
		setPendingIntent(null);
		if (intent) {
			applyIntent(intent);
		}
	}, [applyIntent, detail.data?.notice?.category, pendingIntent]);

	const cancelPendingIntent = useCallback(() => {
		setPendingIntent(null);
	}, []);

	const saveAndContinue = useCallback(async () => {
		const intent = pendingIntent;
		if (!intent) {
			return;
		}
		try {
			await saveDraft();
			setPendingIntent(null);
			applyIntent(intent);
		} catch {
			// Keep the intent open so the operator can retry or cancel after the inline error appears.
		}
	}, [applyIntent, pendingIntent, saveDraft]);

	const blocker = useBlocker({
		disabled: !dirty,
		enableBeforeUnload: dirty,
		shouldBlockFn: () => dirty,
		withResolver: true,
	});

	const saveAndLeave = useCallback(async () => {
		if (blocker.status !== "blocked") {
			return;
		}
		try {
			await saveDraft();
			blocker.proceed();
		} catch {
			// Keep the router blocked after a failed save.
		}
	}, [blocker, saveDraft]);
	const cancelRouteLeave = useCallback(() => {
		if (blocker.status === "blocked") {
			blocker.reset();
		}
	}, [blocker]);
	const discardRouteChanges = useCallback(() => {
		if (blocker.status === "blocked") {
			blocker.proceed();
		}
	}, [blocker]);

	const activeFamilies = useMemo(() => {
		const families = new Set<NoticeJobFamily>();
		for (const job of jobs.data?.jobs ?? []) {
			if (isActiveNoticeJob(job)) {
				families.add(noticeJobFamily(job.operation));
			}
		}
		for (const input of pendingJobInputs) {
			families.add(noticeJobFamily(input.operation));
		}
		return families;
	}, [jobs.data?.jobs, pendingJobInputs]);
	const activeJobCount = useMemo(
		() => (jobs.data?.jobs ?? []).filter(isActiveNoticeJob).length,
		[jobs.data?.jobs],
	);

	const isFamilyBusy = useCallback(
		(family: NoticeJobFamily) => activeFamilies.has(family),
		[activeFamilies],
	);

	const currentNoticeJobs = useMemo(() => {
		if (selectedNoticeId === null) {
			return [];
		}
		return (jobs.data?.jobs ?? []).filter((job) => job.noticeId === selectedNoticeId);
	}, [jobs.data?.jobs, selectedNoticeId]);

	return {
		activeJobCount,
		activeFamilies,
		blocker,
		cancelPendingIntent,
		category,
		cancelRouteLeave,
		createJobError: createJob.error,
		currentNoticeJobs,
		detail,
		discardPendingIntent,
		discardRouteChanges,
		draftCategory,
		dirty,
		filters,
		isFamilyBusy,
		jobs,
		notices,
		pendingIntent,
		q,
		requestCloseNotice,
		requestFilters,
		requestPage,
		requestSearch,
		requestSelectNotice,
		saveAndContinue,
		saveAndLeave,
		saveCategoryError: saveCategory.error,
		saveCategoryPending: saveCategory.isPending,
		saveCategorySucceeded: saveCategory.isSuccess,
		saveDraft,
		search,
		selectedNotice,
		selectedNoticeId,
		setDraftCategory,
		setSearch,
		startJob,
		setTaskCenterOpen,
		state,
		taskCenterOpen,
	};
}
