import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { InternalPortalNoticeSource } from 'ingestion-contracts';
import { noticeSourceRef } from 'ingestion-contracts/notice-source-ref';
import { publishNotices, republishNotices } from '../src/publisher.ts';
import type { PublisherObjectStore } from '../src/store.ts';

function fixture(overrides: Partial<InternalPortalNoticeSource> = {}) {
 const source = {schema_version:'internal_portal_notice_source.v2',notice_id:358366,notice_type:5,organization_id:null,notice_title:'重新发布',notice_release_time:'2026-09-29 15:14',is_external:false,external_url:null,notice_content_html:'<p>更新正文</p>',attachments:[],resources:[],...overrides} as InternalPortalNoticeSource;
 const ref=noticeSourceRef(source);
 const row = {notice_id:'358366',notice_type:5,organization_id:null,title:'原通知',released_at:'2026-09-01T02:57:00Z',is_external:false,external_url:null,category:'campus_news',is_published:true,source_ref:ref,published_source_ref:null,content_html:'old',content_text:'old'};
 const assets: Record<string, unknown>[] = [];
 const query=vi.fn(async(sql:string,_values?:unknown[])=>{
  if(sql.includes('SELECT asset_kind')) return {rowCount:assets.length,rows:assets};
  if(sql.includes('SELECT notice_id::text') || sql.includes('SELECT content_html')) return {rowCount:1,rows:[row]};
  return {rowCount:1,rows:[]};
 });
 const client={query} as unknown as PoolClient;
 const objects=new Map<string,Uint8Array>([[ref,Buffer.from(JSON.stringify(source))],['internal_portal/meta.json',Buffer.from(JSON.stringify({schema_version:'internal_portal_meta.v1',notice_types:{'5':'通知'},organizations:{},updated_at:'2026-10-02T00:00:00Z'}))]]);
 const store:PublisherObjectStore={close(){},createDerivedAsset:vi.fn(),async getSource(key){const body=objects.get(key);if(!body)throw Object.assign(new Error(key),{name:'NoSuchKey'});return{body,contentType:'application/octet-stream'};},async getSourceIfExists(key){return objects.has(key)?this.getSource(key):null;}};
 return{source,ref,row,query,client,objects,store,assets};
}
describe('notice source updates',()=>{
 it.each([publishNotices,republishNotices])('publishes new date and body together while preserving category',async(run)=>{
  const f=fixture();
  expect(await run({client:f.client,objectStore:f.store,portalHost:'my.muc.edu.cn'})).toMatchObject({notices:1,failed:0});
  const call=f.query.mock.calls.find(([sql])=>sql.includes('UPDATE notices.notices'))!;
  expect(call[0]).toContain('source_ref IS NOT DISTINCT FROM');
  expect(call[0]).not.toContain('category=');
  expect(call[1]).toEqual([358366,5,null,'重新发布','2026-09-29T07:14:00.000Z',false,null,'<p>更新正文</p>','更新正文',f.ref,f.ref]);
  expect(f.query).not.toHaveBeenCalledWith('DELETE FROM notices.notice_assets WHERE notice_id=$1',[358366]);
 });
 it.each([{notice_content_html:null},{notice_content_html:null,is_external:true,external_url:'https://example.edu/notice'}])('clears body and resources for empty or external sources',async(override)=>{
  const f=fixture(override as Partial<InternalPortalNoticeSource>);
  f.assets.push({asset_kind:"image",ordinal:0});
  expect(await republishNotices({client:f.client,objectStore:f.store,portalHost:'my.muc.edu.cn'})).toMatchObject({notices:1,updated:1,skipped:0});
  const args=f.query.mock.calls.find(([sql])=>sql.includes('UPDATE notices.notices'))![1]!;
  expect(args.slice(7,9)).toEqual([null,null]);
  expect(f.query).toHaveBeenCalledWith('DELETE FROM notices.notice_assets WHERE notice_id=$1',[358366]);
 });
 it('republishes an image-only source using immutable bytes',async()=>{
  const body=Buffer.from('image content');const sha256=createHash('sha256').update(body).digest('hex');const key=`internal_portal/resources/sha256/${sha256}`;
  const f=fixture({notice_content_html:'<img src="/image.png">',resources:[{kind:'images',ordinal:0,object_key:key,content_type:'image/png',byte_size:body.length,sha256}]});f.objects.set(key,body);
  expect(await republishNotices({client:f.client,objectStore:f.store,portalHost:'my.muc.edu.cn'})).toMatchObject({notices:1,assets:1,skipped:0});
  expect(f.store.createDerivedAsset).toHaveBeenCalledWith(expect.objectContaining({body,digest:sha256}));
 });
 it.each([publishNotices,republishNotices])('does not replace assets when a newer source arrives before commit',async(run)=>{
  const f=fixture();f.query.mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT notice_id::text'))return{rows:[f.row],rowCount:1};
   if(sql.includes('SELECT content_html'))return{rows:[{...f.row,source_ref:'newer'}],rowCount:1};
   return{rows:[],rowCount:sql.includes('UPDATE notices.notices')?0:1};
  });
  expect(await run({client:f.client,objectStore:f.store,portalHost:'my.muc.edu.cn'})).toMatchObject({failed:1,notices:0});
  expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  expect(f.query).not.toHaveBeenCalledWith('DELETE FROM notices.notice_assets WHERE notice_id=$1',[358366]);
 });
 it('keeps a failed update eligible for the next ordinary publication',async()=>{
  const f=fixture();await publishNotices({client:f.client,objectStore:f.store,portalHost:'my.muc.edu.cn'});
  const sql=f.query.mock.calls[0]![0];expect(sql).toContain('source_ref IS DISTINCT FROM published_source_ref');expect(sql).not.toContain('processing_failures');
 });
});

function attachmentFixture() {
	const body = Buffer.from("attachment");
	const sha256 = createHash("sha256").update(body).digest("hex");
	const key = `internal_portal/resources/sha256/${sha256}`;
	const f = fixture({
		attachments: [0, 1].map((n) => ({
			notice_annex_id: `annex-${n}`,
			notice_annex_name: `${n}.pdf`,
			notice_annex_path: null,
			suffix: "pdf",
			type: "application/pdf",
		})),
		resources: [0, 1].map((ordinal) => ({
			kind: "attachments",
			ordinal,
			object_key: key,
			content_type: "application/pdf",
			byte_size: body.length,
			sha256,
		})),
	});
	f.objects.set(key, body);
	f.assets.push(
		...[1, 0].map((ordinal) => ({
			asset_kind: "attachment",
			ordinal,
			original_name: `${ordinal}.pdf`,
			content_type: "application/pdf",
			byte_size: String(body.length),
			content_sha256: sha256,
			portal_annex_id: `annex-${ordinal}`,
		})),
	);
	return f;
}

describe("asset write avoidance", () => {
	it.each([publishNotices, republishNotices])(
		"keeps identical assets while updating the notice projection",
		async (run) => {
			const f = attachmentFixture();
			await expect(
				run({ client: f.client, objectStore: f.store, portalHost: "my.muc.edu.cn" }),
			).resolves.toMatchObject({ notices: 1, assets: 2 });
			expect(
				f.query.mock.calls.some(([sql]) =>
					/(?:DELETE FROM|INSERT INTO) notices.notice_assets/.test(sql),
				),
			).toBe(false);
			expect(f.query.mock.calls.some(([sql]) => sql.includes("UPDATE notices.notices"))).toBe(true);
			expect(f.query).toHaveBeenCalledWith("COMMIT");
		},
	);
	it.each([
		"original_name",
		"content_type",
		"byte_size",
		"content_sha256",
		"portal_annex_id",
		"ordinal",
		"asset_kind",
		"missing",
		"extra",
		"swap",
	])("replaces the group when %s changes", async (field) => {
		const f = attachmentFixture();
		if (field === "missing") f.assets.pop();
		else if (field === "extra") f.assets.push({ ...f.assets[0], ordinal: 2 });
		else if (field === "swap") {
			f.assets[0]!.ordinal = 0;
			f.assets[1]!.ordinal = 1;
		} else f.assets[0]![field] = field === "byte_size" || field === "ordinal" ? "99" : "different";
		await expect(
			publishNotices({ client: f.client, objectStore: f.store, portalHost: "my.muc.edu.cn" }),
		).resolves.toMatchObject({ notices: 1 });
		expect(f.query).toHaveBeenCalledWith(
			"DELETE FROM notices.notice_assets WHERE notice_id=$1",
			[358366],
		);
		expect(
			f.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notices.notice_assets")),
		).toHaveLength(2);
	});
	it("rolls back a failed asset insertion", async () => {
		const f = attachmentFixture();
		f.assets.pop();
		const query = f.query.getMockImplementation()!;
		f.query.mockImplementation(async (sql, values) => {
			if (sql.includes("INSERT INTO notices.notice_assets")) throw new Error("insert failed");
			return query(sql, values);
		});
		await expect(
			publishNotices({ client: f.client, objectStore: f.store, portalHost: "my.muc.edu.cn" }),
		).rejects.toThrow("insert failed");
		expect(f.query).toHaveBeenCalledWith("ROLLBACK");
		expect(f.query).not.toHaveBeenCalledWith("COMMIT");
	});
});
