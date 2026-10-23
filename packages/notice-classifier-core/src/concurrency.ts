export async function mapWithConcurrency<Input, Output>(
	inputs: readonly Input[],
	concurrency: number,
	map: (input: Input) => Promise<Output>,
): Promise<Output[]> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error("concurrency must be a positive integer");
	}

	const outputs = new Array<Output>(inputs.length);
	let nextIndex = 0;
	let failure: { error: unknown } | undefined;

	async function worker(): Promise<void> {
		while (!failure) {
			const index = nextIndex;
			if (index >= inputs.length) {
				return;
			}
			nextIndex += 1;
			try {
				outputs[index] = await map(inputs[index] as Input);
			} catch (error) {
				failure ??= { error };
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
	if (failure) {
		throw failure.error;
	}
	return outputs;
}
