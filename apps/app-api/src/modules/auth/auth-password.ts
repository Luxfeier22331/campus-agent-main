import { hashPassword, verifyPassword } from "better-auth/crypto";

export async function hashAppPassword(password: string): Promise<string> {
	return hashPassword(password);
}

export async function verifyAppPassword(input: {
	hash: string;
	password: string;
}): Promise<boolean> {
	return verifyPassword(input);
}
