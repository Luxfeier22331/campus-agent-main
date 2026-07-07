import type { LearningLoopCandidate, LearningLoopCandidatePublisher } from "./types";

export async function publishCandidates(input: {
	candidates: LearningLoopCandidate[];
	dryRun: boolean;
	publisher: LearningLoopCandidatePublisher;
}): Promise<{
	dryRun: boolean;
	publishedCount: number;
	selectedCount: number;
}> {
	if (input.dryRun) {
		return {
			dryRun: true,
			publishedCount: 0,
			selectedCount: input.candidates.length,
		};
	}

	const result = await input.publisher.publish(input.candidates);
	return {
		dryRun: false,
		publishedCount: result.publishedCount,
		selectedCount: input.candidates.length,
	};
}

export async function verifyPublishedCandidates(input: {
	candidates: LearningLoopCandidate[];
	publisher: LearningLoopCandidatePublisher;
}): Promise<{
	expectedCount: number;
	matchedCount: number;
	missingIds: string[];
	selectedCount: number;
}> {
	if (!input.publisher.verify) {
		throw new Error("learning-loop candidate publisher does not support verification");
	}
	const result = await input.publisher.verify(input.candidates);
	return {
		...result,
		selectedCount: input.candidates.length,
	};
}
