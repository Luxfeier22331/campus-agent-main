import type { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
export type SettingsRow = typeof profileMemorySettings.$inferSelect;
export type CommandRow = typeof profileMemoryCommands.$inferSelect;
