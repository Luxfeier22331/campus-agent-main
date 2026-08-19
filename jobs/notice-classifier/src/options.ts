export interface NoticeClassifierCliOptions {
	concurrency: number;
	noticeIds: number[] | undefined;
	providerSnapshotUrl: string | undefined;
}

export function parseNoticeClassifierOptions(argv: readonly string[]): NoticeClassifierCliOptions {
	let concurrency = 2;
	const noticeIds: number[] = [];
	let providerSnapshotUrl: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = argv[index + 1];
		if (argument === "--concurrency" && value) {
			concurrency = parsePositiveInteger(value, "concurrency");
			index += 1;
			continue;
		}
		if (argument === "--provider-snapshot-url" && value) {
			providerSnapshotUrl = parseProviderSnapshotUrl(value);
			index += 1;
			continue;
		}
		if (argument === "--notice-id" && value) {
			if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
				throw new Error(`invalid notice id: ${value}`);
			}
			const noticeId = Number(value);
			if (noticeIds.includes(noticeId)) throw new Error(`duplicate notice id: ${noticeId}`);
			noticeIds.push(noticeId);
			index += 1;
			continue;
		}
		throw new Error(
			"Usage: notice-classifier [--concurrency <positive-integer>] [--provider-snapshot-url <url>] [--notice-id <positive-integer> ...]",
		);
	}
	return {
		concurrency,
		noticeIds: noticeIds.length > 0 ? noticeIds : undefined,
		providerSnapshotUrl,
	};
}

function parsePositiveInteger(value: string, name: string): number {
	if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`invalid ${name}: ${value}`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${name}: ${value}`);
	return parsed;
}

function parseProviderSnapshotUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`invalid provider snapshot url: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`invalid provider snapshot url: ${value}`);
	}
	return parsed.toString().replace(/\/$/u, "");
}
