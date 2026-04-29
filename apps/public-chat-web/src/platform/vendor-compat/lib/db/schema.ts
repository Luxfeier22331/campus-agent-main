export interface User {
	createdAt: string;
	email: string;
	emailVerified: boolean;
	id: string;
	image?: string | null;
	isAnonymous?: boolean;
	name?: string | null;
	password?: string | null;
	updatedAt: string;
}

export interface Chat {
	createdAt: string;
	id: string;
	title: string;
	updatedAt: string;
	visibility: "private" | "public";
}

export interface DBMessage {
	attachments: unknown;
	createdAt: Date;
	id: string;
	parts: unknown;
	role: string;
}

export interface AnswerFeedback {
	createdAt?: string;
	feedbackId?: string;
	messageId: string;
	reasonCodes: string[];
	updatedAt?: string;
	vote: "helpful" | "unhelpful";
}

export interface Document {
	content?: string | null;
	createdAt: Date;
	id: string;
	kind: "code" | "image" | "sheet" | "text";
	title: string;
	userId: string;
}

export interface Suggestion {
	createdAt: Date;
	description?: string | null;
	documentCreatedAt: Date;
	documentId: string;
	id: string;
	isResolved: boolean;
	originalText: string;
	suggestedText: string;
	userId: string;
}

export interface Stream {
	chatId: string;
	createdAt: Date;
	id: string;
}
