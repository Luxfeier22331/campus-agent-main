export type User = {
	email?: string | null;
	name?: string | null;
};

export interface DefaultSession {
	user?: User | null;
}

export interface Session extends DefaultSession {}
