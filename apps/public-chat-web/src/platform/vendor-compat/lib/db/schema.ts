export type User = {
  createdAt: string;
  email: string;
  emailVerified: boolean;
  id: string;
  image?: string | null;
  isAnonymous?: boolean;
  name?: string | null;
  password?: string | null;
  updatedAt: string;
};

export type Chat = {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
  visibility: "private" | "public";
};

export type DBMessage = {
  attachments: unknown;
  createdAt: Date;
  id: string;
  parts: unknown;
  role: string;
};

export type Vote = {
  chatId?: string;
  isUpvoted?: boolean;
  messageId: string;
};

export type Document = {
  content?: string | null;
  createdAt: Date;
  id: string;
  kind: "code" | "image" | "sheet" | "text";
  title: string;
  userId: string;
};

export type Suggestion = {
  createdAt: Date;
  description?: string | null;
  documentCreatedAt: Date;
  documentId: string;
  id: string;
  isResolved: boolean;
  originalText: string;
  suggestedText: string;
  userId: string;
};

export type Stream = {
  chatId: string;
  createdAt: Date;
  id: string;
};
