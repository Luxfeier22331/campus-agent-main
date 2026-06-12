// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildCampusServicesOpsService,
	createInMemoryCampusServicesOpsStore,
} from "../src/modules/campus-services-ops";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
} from "./operator-query.route.test-support";

const fixedNow = new Date("2026-06-11T08:00:00.000Z");

describe("campus services ops service", () => {
	it("records manual attestations as operator-owned source truth without raw evidence blobs", async () => {
		const service = buildCampusServicesOpsService({
			generateId: (prefix) => `${prefix}_001`,
			now: () => fixedNow,
			store: createInMemoryCampusServicesOpsStore(),
		});

		const result = await service.createAttestation({
			principal: createOperatorPrincipal(),
			payload: {
				confirmedAt: "2026-06-11T07:50:00.000Z",
				sourceType: "counselor_notice",
				summary: "导员确认今日医保窗口下午暂停办理。",
				operatorNotes: "已人工校对，不包含聊天截图原文。",
			},
		});

		expect(result.attestation).toMatchObject({
			attestationId: "services_attestation_001",
			confirmedAt: "2026-06-11T07:50:00.000Z",
			createdAt: "2026-06-11T08:00:00.000Z",
			createdBy: {
				displayName: "Ops Team",
				principalId: "ops@example.com",
			},
			sourceType: "counselor_notice",
			status: "active",
			summary: "导员确认今日医保窗口下午暂停办理。",
		});

		const audit = await service.listAuditEvents({
			principal: createOperatorPrincipal(),
		});
		expect(audit.auditEvents).toHaveLength(1);
		expect(audit.auditEvents[0]).toMatchObject({
			action: "attestation.created",
			actor: {
				displayName: "Ops Team",
				principalId: "ops@example.com",
			},
			objectType: "source_attestation",
		});
		expect(JSON.stringify(audit)).not.toMatch(/截图|raw|bucket|objectKey/);
	});

	it("fails closed when non-operator principals attempt to mutate service ops truth", async () => {
		const service = buildCampusServicesOpsService({
			now: () => fixedNow,
			store: createInMemoryCampusServicesOpsStore(),
		});

		await expect(
			service.createStatusOverride({
				principal: createCampusPrincipal(),
				payload: {
					displayName: "医保窗口",
					effectiveFrom: "2026-06-11T09:00:00.000Z",
					effectiveUntil: "2026-06-11T12:00:00.000Z",
					message: "暂停办理",
					serviceId: "medical_insurance_counter",
					sourceAttestationIds: [],
					status: "closed",
				},
			}),
		).rejects.toMatchObject({
			code: "forbidden",
			status: 403,
		});
	});

	it("requires bounded effective windows for status override drafts", async () => {
		const service = buildCampusServicesOpsService({
			now: () => fixedNow,
			store: createInMemoryCampusServicesOpsStore(),
		});

		await expect(
			service.createStatusOverride({
				principal: createOperatorPrincipal(),
				payload: {
					displayName: "医保窗口",
					effectiveFrom: "2026-06-11T12:00:00.000Z",
					effectiveUntil: "2026-06-11T09:00:00.000Z",
					message: "暂停办理",
					serviceId: "medical_insurance_counter",
					sourceAttestationIds: [],
					status: "closed",
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
	});

	it("previews and publishes current effective status and transport overrides atomically", async () => {
		const store = createInMemoryCampusServicesOpsStore();
		const service = buildCampusServicesOpsService({
			generateId: (prefix) => `${prefix}_${prefix.endsWith("release") ? "rel" : "001"}`,
			now: () => fixedNow,
			store,
		});
		const principal = createOperatorPrincipal();

		const attestation = await service.createAttestation({
			principal,
			payload: {
				confirmedAt: "2026-06-11T07:50:00.000Z",
				sourceType: "phone_confirmation",
				summary: "校车队电话确认晚间接驳车增开一班。",
			},
		});
		const status = await service.createStatusOverride({
			principal,
			payload: {
				displayName: "医保窗口",
				effectiveFrom: "2026-06-11T07:00:00.000Z",
				effectiveUntil: "2026-06-11T10:00:00.000Z",
				message: "下午恢复办理前暂停服务。",
				serviceId: "medical_insurance_counter",
				sourceAttestationIds: [attestation.attestation.attestationId],
				status: "closed",
			},
		});
		const transport = await service.createTransportOverride({
			principal,
			payload: {
				displayName: "两校区晚间接驳",
				effectiveFrom: "2026-06-11T07:30:00.000Z",
				effectiveUntil: "2026-06-11T09:30:00.000Z",
				message: "南湖至将军路 18:30 增开。",
				routeId: "nanhu_jiangjunlu_evening",
				serviceStatus: "extra_service",
				sourceAttestationIds: [attestation.attestation.attestationId],
			},
		});

		const preview = await service.previewRelease({
			payload: { notes: "发布今日人工校对服务调整。" },
			principal,
		});

		expect(preview.preview.currentEffective.statusOverrides).toEqual([
			expect.objectContaining({
				overrideId: status.override.overrideId,
				serviceId: "medical_insurance_counter",
			}),
		]);
		expect(preview.preview.currentEffective.transportOverrides).toEqual([
			expect.objectContaining({
				overrideId: transport.override.overrideId,
				routeId: "nanhu_jiangjunlu_evening",
			}),
		]);
		expect((await service.listReleases({ principal })).releases).toEqual([]);

		const publish = await service.publishRelease({
			payload: { notes: "发布今日人工校对服务调整。" },
			principal,
		});

		expect(publish.release).toMatchObject({
			itemCount: 2,
			notes: "发布今日人工校对服务调整。",
			publishedAt: "2026-06-11T08:00:00.000Z",
			releaseId: "services_release_rel",
			status: "published",
		});
		expect(publish.currentEffective.statusOverrides).toHaveLength(1);
		expect(publish.currentEffective.transportOverrides).toHaveLength(1);
		await expect(service.listReleases({ principal })).resolves.toMatchObject({
			releases: [
				expect.objectContaining({
					releaseId: "services_release_rel",
				}),
			],
		});
	});
});
