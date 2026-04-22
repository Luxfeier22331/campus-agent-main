declare global {
	interface RequestInit {
		next?: {
			revalidate?: number;
		};
	}

	interface Body {
		json(): Promise<unknown>;
	}
}

export {};
