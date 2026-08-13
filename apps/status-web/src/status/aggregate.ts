import {
	PRODUCT_AVAILABILITY_SCHEMA_VERSION,
	type ProductAvailabilitySnapshot,
	ProductAvailabilitySnapshotSchema,
	type ProductAvailabilityStatus,
} from "campus-contracts/product-availability";

import type { AvailabilityServiceDefinition, ProbeObservation, StatusRuntimeConfig } from "./types";

const STATUS_SEVERITY: Record<ProductAvailabilityStatus, number> = {
	operational: 0,
	degraded: 1,
	outage: 2,
	unknown: 3,
};

export const STATUS_TIME_ZONE = "Asia/Shanghai";
const STATUS_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
	day: "2-digit",
	month: "2-digit",
	timeZone: STATUS_TIME_ZONE,
	year: "numeric",
});

export function aggregateServiceStatus(
	definition: AvailabilityServiceDefinition,
	observations: readonly ProbeObservation[],
): ProductAvailabilityStatus {
	const serviceObservations = observations.filter((item) => item.serviceId === definition.id);
	const expectedProbes = [
		definition.shell,
		...definition.capabilities.flatMap((capability) => capability.probes),
	];
	const observationsByProbe = new Map<string, ProbeObservation>();
	for (const observation of serviceObservations) {
		if (observationsByProbe.has(observation.probeId)) {
			return "unknown";
		}
		observationsByProbe.set(observation.probeId, observation);
	}
	if (expectedProbes.some((probe) => !observationsByProbe.has(probe.id))) {
		return "unknown";
	}
	if (observationsByProbe.size !== expectedProbes.length) {
		return "unknown";
	}
	const shellStatus = observationsByProbe.get(definition.shell.id)?.status;
	if (shellStatus === "unknown") {
		return "unknown";
	}
	if (shellStatus !== "passed") {
		return "outage";
	}
	const capabilityPassed = definition.capabilities.map((capability) =>
		capability.probes.every((probe) => observationsByProbe.get(probe.id)?.status === "passed"),
	);
	const passedCount = capabilityPassed.filter(Boolean).length;
	if (capabilityPassed.length > 0 && passedCount === 0) {
		return "outage";
	}
	return passedCount === capabilityPassed.length ? "operational" : "degraded";
}

export function buildAvailabilitySnapshot(input: {
	config: StatusRuntimeConfig;
	definitions: readonly AvailabilityServiceDefinition[];
	observations: readonly ProbeObservation[];
	previous: ProductAvailabilitySnapshot | null;
	now?: Date;
}): ProductAvailabilitySnapshot {
	const now = input.now ?? new Date();
	const currentDay = statusDay(now);
	const previousById = new Map<string, ProductAvailabilitySnapshot["services"][number]>(
		input.previous?.environment === input.config.environment
			? input.previous.services.map((service) => [service.id, service] as const)
			: [],
	);
	const services = input.definitions.map((definition) => {
		const status = aggregateServiceStatus(definition, input.observations);
		const checkedAt = latestCheckedAt(
			input.observations.filter((observation) => observation.serviceId === definition.id),
		);
		const previous = previousById.get(definition.id);
		const timeline = new Map(previous?.timeline.map((entry) => [entry.day, entry.status]) ?? []);
		const existing = timeline.get(currentDay);
		timeline.set(currentDay, existing ? mergeTimelineStatus(existing, status) : status);
		return {
			checkedAt,
			id: definition.id,
			name: definition.name,
			status,
			timeline: [...timeline.entries()]
				.filter(([day]) => {
					const age = daysSince(day, now);
					return age >= 0 && age < input.config.retentionDays;
				})
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([day, entryStatus]) => ({ day, status: entryStatus })),
		};
	});
	return ProductAvailabilitySnapshotSchema.parse({
		environment: input.config.environment,
		expiresAt: new Date(now.getTime() + input.config.expiresInMs).toISOString(),
		generatedAt: now.toISOString(),
		schemaVersion: PRODUCT_AVAILABILITY_SCHEMA_VERSION,
		services,
	});
}

export function markExpiredSnapshot(
	snapshot: ProductAvailabilitySnapshot,
	now: Date = new Date(),
): ProductAvailabilitySnapshot {
	if (new Date(snapshot.expiresAt).getTime() > now.getTime()) {
		return snapshot;
	}
	return ProductAvailabilitySnapshotSchema.parse({
		...snapshot,
		services: snapshot.services.map((service) => ({ ...service, status: "unknown" })),
	});
}

export function mergeTimelineStatus(
	left: ProductAvailabilityStatus,
	right: ProductAvailabilityStatus,
): ProductAvailabilityStatus {
	if (left === "unknown") {
		return right;
	}
	if (right === "unknown") {
		return left;
	}
	return STATUS_SEVERITY[left] >= STATUS_SEVERITY[right] ? left : right;
}

function latestCheckedAt(observations: readonly ProbeObservation[]): string | null {
	const [first, ...rest] = observations;
	if (!first) {
		return null;
	}
	return rest.reduce(
		(latest, observation) => (observation.checkedAt > latest ? observation.checkedAt : latest),
		first.checkedAt,
	);
}

function statusDay(value: Date): string {
	const parts = Object.fromEntries(
		STATUS_DAY_FORMATTER.formatToParts(value)
			.filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysSince(day: string, now: Date): number {
	const dayTime = Date.parse(`${day}T00:00:00.000Z`);
	return Math.floor((Date.parse(`${statusDay(now)}T00:00:00.000Z`) - dayTime) / 86_400_000);
}
