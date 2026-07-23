import type { DiningDevSeed } from "@campus-agent/dining/domain";
import { Client } from "pg";

export class PostgresDiningDevSeedImporter {
	private readonly databaseUrl: string;

	constructor(databaseUrl: string) {
		this.databaseUrl = databaseUrl;
	}

	async import(seed: DiningDevSeed): Promise<void> {
		const client = new Client({ connectionString: this.databaseUrl });
		await client.connect();
		try {
			await client.query("BEGIN");
			for (const table of [
				"operation_events",
				"review_recheck_requests",
				"review_overrides",
				"reviews",
				"publication",
				"catalog_state",
				"releases",
				"catalog_overrides",
				"menu_offerings",
				"menu_items",
				"window_assignments",
				"stall_profiles",
				"windows",
				"floors",
				"halls",
			]) {
				await client.query(`DELETE FROM dining.${table}`);
			}
			const now = new Date(seed.draft.updatedAt);
			for (const hall of seed.draft.halls) {
				await client.query(
					"INSERT INTO dining.halls(hall_id,campus,name,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
					[hall.hallId, hall.campus, hall.name, hall.status, now],
				);
				for (const [index, floor] of hall.floors.entries()) {
					await client.query(
						"INSERT INTO dining.floors(floor_id,hall_id,label,floorplan_kind,floorplan_id,sort_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
						[
							floor.floorId,
							hall.hallId,
							floor.label,
							floor.floorplan.kind,
							floor.floorplan.floorplanId,
							String(index).padStart(4, "0"),
							now,
						],
					);
				}
			}
			for (const window of seed.draft.windows) {
				await client.query(
					"INSERT INTO dining.windows(window_id,hall_id,floor_id,label,location_label,svg_anchor_id,tags_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
					[
						window.windowId,
						window.hallId,
						window.floorId,
						window.label,
						window.locationLabel,
						window.svgAnchorId,
						JSON.stringify(window.tags),
						window.status,
						now,
					],
				);
			}
			for (const stall of seed.draft.stallProfiles) {
				await client.query(
					"INSERT INTO dining.stall_profiles(stall_profile_id,display_name,stall_type,tags_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
					[
						stall.stallProfileId,
						stall.displayName,
						stall.stallType,
						JSON.stringify(stall.tags),
						stall.status,
						now,
					],
				);
			}
			for (const assignment of seed.draft.assignments) {
				await client.query(
					"INSERT INTO dining.window_assignments(assignment_id,window_id,stall_profile_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
					[
						assignment.assignmentId,
						assignment.windowId,
						assignment.stallProfileId,
						assignment.status,
						now,
					],
				);
			}
			for (const item of seed.draft.menuItems) {
				await client.query(
					"INSERT INTO dining.menu_items(menu_item_id,name,tags_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
					[item.menuItemId, item.name, JSON.stringify(item.tags), item.status, now],
				);
			}
			for (const offering of seed.draft.menuOfferings) {
				await client.query(
					"INSERT INTO dining.menu_offerings(offering_id,assignment_id,menu_item_id,price_label,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
					[
						offering.offeringId,
						offering.assignmentId,
						offering.menuItemId,
						offering.priceLabel,
						now,
					],
				);
			}
			await client.query(
				"INSERT INTO dining.releases(release_id,predecessor_release_id,rollback_of_release_id,draft_revision,notes,snapshot_hash,payload_json,validation_json,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
				[
					seed.release.releaseId,
					seed.release.predecessorReleaseId,
					seed.release.rollbackOfReleaseId,
					seed.release.draftRevision,
					seed.release.notes,
					seed.release.snapshotHash,
					JSON.stringify(seed.snapshot),
					JSON.stringify(seed.release.validation),
					new Date(seed.release.createdAt),
					seed.release.createdBy,
				],
			);
			await client.query(
				"INSERT INTO dining.catalog_state(scope,draft_revision,base_release_id,updated_at,updated_by) VALUES('global',$1,$2,$3,$4)",
				[seed.draft.revision, seed.release.releaseId, now, seed.draft.updatedBy],
			);
			await client.query(
				"INSERT INTO dining.publication(scope,catalog_release_id,review_revision,updated_at) VALUES('global',$1,$2,$3)",
				[
					seed.publication.catalogReleaseId,
					seed.publication.reviewRevision,
					new Date(seed.publication.updatedAt),
				],
			);
			for (const review of seed.reviews) {
				await client.query(
					`INSERT INTO dining.reviews(
						review_id,source_record_id,campus,hall_name,stall_name,dish_name,paid_price_label,
						rating,comment,contributor_name,images_json,submitted_at,moderation_status,visibility,
						hall_id,stall_profile_id,window_id,offering_id,published_at,created_at,updated_at
					) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'safe','published',$13,$14,$15,$16,$17,$17,$17)`,
					[
						review.reviewId,
						review.sourceRecordId,
						review.campus,
						review.hallName,
						review.stallName,
						review.dishName,
						review.paidPriceLabel,
						review.rating,
						review.comment,
						review.contributorName,
						JSON.stringify(review.images),
						new Date(review.submittedAt),
						review.hallId,
						review.stallProfileId,
						review.windowId,
						review.offeringId,
						now,
					],
				);
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			await client.end();
		}
	}
}
