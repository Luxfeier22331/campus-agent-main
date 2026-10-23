import { z } from "zod";

export const PRODUCT_AVAILABILITY_SCHEMA_VERSION = "product-availability-snapshot.v1" as const;

export const ProductAvailabilityStatusSchema = z.enum([
	"operational",
	"degraded",
	"outage",
	"unknown",
]);

export const ChatAvailabilityStatusSchema = z.enum(["operational", "outage", "unknown"]);

export const ChatAvailabilityResponseSchema = z
	.object({
		status: ChatAvailabilityStatusSchema,
	})
	.strict();

export const ProductAvailabilityEnvironmentSchema = z.enum([
	"development",
	"staging",
	"production",
]);

const ProductAvailabilityTimestampSchema = z.string().datetime({ offset: true });
const ProductAvailabilityDaySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/u, "时间线日期必须使用 YYYY-MM-DD 格式。");

export const ProductAvailabilityTimelineEntrySchema = z
	.object({
		day: ProductAvailabilityDaySchema,
		status: ProductAvailabilityStatusSchema,
	})
	.strict();

const ProductAvailabilityServiceFields = {
	checkedAt: ProductAvailabilityTimestampSchema.nullable(),
	status: ProductAvailabilityStatusSchema,
	timeline: z.array(ProductAvailabilityTimelineEntrySchema).max(31),
} as const;

export const CampusQaProductAvailabilityServiceSchema = z
	.object({
		...ProductAvailabilityServiceFields,
		id: z.literal("campus.qa"),
		name: z.literal("校园问答"),
	})
	.strict();

export const CampusServicesProductAvailabilityServiceSchema = z
	.object({
		...ProductAvailabilityServiceFields,
		id: z.literal("campus.services"),
		name: z.literal("其他服务"),
	})
	.strict();

export const ProductAvailabilityServiceSchema = z.union([
	CampusQaProductAvailabilityServiceSchema,
	CampusServicesProductAvailabilityServiceSchema,
]);

export const ProductAvailabilitySnapshotSchema = z
	.object({
		environment: ProductAvailabilityEnvironmentSchema,
		expiresAt: ProductAvailabilityTimestampSchema,
		generatedAt: ProductAvailabilityTimestampSchema,
		schemaVersion: z.literal(PRODUCT_AVAILABILITY_SCHEMA_VERSION),
		services: z
			.tuple([
				CampusQaProductAvailabilityServiceSchema,
				CampusServicesProductAvailabilityServiceSchema,
			])
			.meta({ maxItems: 2, minItems: 2 }),
	})
	.strict();

export type ProductAvailabilityStatus = z.infer<typeof ProductAvailabilityStatusSchema>;
export type ChatAvailabilityStatus = z.infer<typeof ChatAvailabilityStatusSchema>;
export type ChatAvailabilityResponse = z.infer<typeof ChatAvailabilityResponseSchema>;
export type ProductAvailabilityEnvironment = z.infer<typeof ProductAvailabilityEnvironmentSchema>;
export type ProductAvailabilityService = z.infer<typeof ProductAvailabilityServiceSchema>;
export type ProductAvailabilitySnapshot = z.infer<typeof ProductAvailabilitySnapshotSchema>;
