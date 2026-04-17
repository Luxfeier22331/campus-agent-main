export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT,
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = "campus-agent-disabled-auth";

export const suggestions = [
  "法学民族班培养方案里大二下有什么课",
  "哪些专业要上习概",
  "民族实验班有哪些",
  "基地班有哪些",
];
