import type {
	ProductAvailabilityEnvironment,
	ProductAvailabilitySnapshot,
} from "campus-contracts/product-availability";

export type {
	ProductAvailabilityService,
	ProductAvailabilitySnapshot,
	ProductAvailabilityStatus,
} from "campus-contracts/product-availability";

export type ProbeObservationStatus = "passed" | "failed" | "timed_out" | "invalid" | "unknown";

export type ProbeValidator = "campus_html" | "chat_availability";

export interface ProbeDefinition {
	id: string;
	serviceId: string;
	path: string;
	bodyKind: "html" | "json";
	origin: "campus" | "qa";
	validator: ProbeValidator;
	method?: "GET" | "HEAD";
}

export interface ProbeObservation {
	probeId: string;
	serviceId: string;
	status: ProbeObservationStatus;
	checkedAt: string;
	latencyMs: number;
	httpStatus: number | null;
	errorKind: "network" | "timeout" | "http" | "content" | null;
}

export interface AvailabilityServiceDefinition {
	capabilities: readonly AvailabilityCapabilityDefinition[];
	id: string;
	name: string;
	shell: ProbeDefinition;
}

export interface AvailabilityCapabilityDefinition {
	id: string;
	name: string;
	probes: readonly ProbeDefinition[];
}

export interface StatusStore {
	read(): Promise<ProductAvailabilitySnapshot | null>;
	write(snapshot: ProductAvailabilitySnapshot): Promise<void>;
}

export interface StatusRuntimeConfig {
	environment: ProductAvailabilityEnvironment;
	campusOrigin: string;
	expiresInMs: number;
	qaOrigin: string;
	retentionDays: number;
}
