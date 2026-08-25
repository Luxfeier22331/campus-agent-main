export function parsePortalReleaseTime(value: string | null, key = "notice"): string {
	if (value === null) {
		throw new Error(`${key} has no notice_release_time`);
	}
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
	if (!match) {
		throw new Error(`${key} has invalid notice_release_time: ${value}`);
	}
	const parts = match.slice(1).map((part) => Number(part ?? "0"));
	const [year, month, day, hour, minute, second] = parts as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	if (
		localAsUtc.getUTCFullYear() !== year ||
		localAsUtc.getUTCMonth() !== month - 1 ||
		localAsUtc.getUTCDate() !== day ||
		localAsUtc.getUTCHours() !== hour ||
		localAsUtc.getUTCMinutes() !== minute ||
		localAsUtc.getUTCSeconds() !== second
	) {
		throw new Error(`${key} has invalid notice_release_time: ${value}`);
	}
	return new Date(localAsUtc.getTime() - 8 * 60 * 60 * 1000).toISOString();
}
