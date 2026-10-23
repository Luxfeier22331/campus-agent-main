import { createNoticeDatabasePool } from '@campus-agent/notice-database';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { publishNotices } from '../src/publisher.ts';
import type { PublisherObjectStore } from '../src/store.ts';

describe.skipIf(!process.env.NOTICES_DATABASE_URL)('publication transaction recovery', () => {
 it('isolates invalid items, excludes them automatically, and atomically clears explicit recovery', async () => {
  const pool=createNoticeDatabasePool(process.env,{max:1});
  const client=await pool.connect();
  await client.query('BEGIN');
  try {
   const rows=(await client.query(`SELECT *, to_char(released_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS source_time FROM notices.notices WHERE NOT is_external ORDER BY notice_id LIMIT 2`)).rows;
   expect(rows).toHaveLength(2);
   const ids=rows.map(row=>Number(row.notice_id));
   await client.query("UPDATE notices.notices SET category='campus_news', is_published=false, content_html=NULL, content_text=NULL WHERE notice_id=ANY($1)",[ids]);
   await client.query('DELETE FROM notices.notice_assets WHERE notice_id=ANY($1)',[ids]);
   await client.query("DELETE FROM notices.processing_failures WHERE notice_id=ANY($1) AND stage='publication'",[ids]);
   let bad=true;
   let outage=false;
   const requested:number[]=[];
   const store:PublisherObjectStore={
    close(){}, async createDerivedAsset(){},async getSourceIfExists(){return null;},
    async getSource(key){
     if(key.endsWith('meta.json')) return {body:Buffer.from(JSON.stringify({schema_version:'internal_portal_meta.v1',updated_at:'2026-09-20T00:00:00Z',notice_types:Object.fromEntries(rows.map(r=>[String(r.notice_type),'通知'])),organizations:Object.fromEntries(rows.filter(r=>r.organization_id).map(r=>[r.organization_id,'组织']))})),contentType:'application/json'};
     const row=rows.find(r=>key.endsWith(`/${r.notice_id}.json`));
     if(!row) throw new Error('unexpected source '+key);
     requested.push(Number(row.notice_id));
     if(bad && Number(row.notice_id)===ids[0]) return {body:Buffer.from('invalid'),contentType:'application/json'};
     return {body:Buffer.from(JSON.stringify({schema_version:'internal_portal_notice_source.v2',notice_id:Number(row.notice_id),notice_title:row.title,notice_type:row.notice_type,organization_id:row.organization_id,notice_release_time:row.source_time,is_external:false,external_url:null,notice_content_html:'<p>发布事务恢复验收正文</p>',attachments:[]})),contentType:'application/json'};
    },
   };
   // Nested per-item transactions use real savepoints so the fixture always rolls back.
   const database={query:async(sql:string,args?:unknown[])=>{
    if(sql==='BEGIN')return client.query('SAVEPOINT notice_item');
    if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT notice_item');
    if(sql==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT notice_item');
    if(outage && sql.startsWith('DELETE FROM notices.processing_failures'))throw new Error('injected write failure');
    return client.query(sql,args);
   }} as PoolClient;
   const input={client:database,objectStore:store,portalHost:'my.muc.edu.cn'};
   expect(await publishNotices({...input,noticeIds:ids})).toMatchObject({notices:1,failed:1,outcome:'partial'});
   expect((await client.query('SELECT is_published FROM notices.notices WHERE notice_id=$1',[ids[1]])).rows[0].is_published).toBe(true);
   requested.length=0;
   // All other worktree notices are temporarily marked published to isolate automatic selection.
   await client.query('UPDATE notices.notices SET is_published=true WHERE notice_id<>$1',[ids[0]]);
   expect(await publishNotices(input)).toMatchObject({notices:0});
   expect(requested).toEqual([]);
   bad=false;outage=true;
   await expect(publishNotices({...input,noticeIds:[ids[0]!]})).rejects.toThrow('injected write failure');
   expect((await client.query('SELECT is_published FROM notices.notices WHERE notice_id=$1',[ids[0]])).rows[0].is_published).toBe(false);
   expect((await client.query("SELECT * FROM notices.processing_failures WHERE notice_id=$1 AND stage='publication'",[ids[0]])).rows).toHaveLength(1);
   outage=false;
   expect(await publishNotices({...input,noticeIds:[ids[0]!]})).toMatchObject({notices:1,failed:0});
   expect((await client.query("SELECT * FROM notices.processing_failures WHERE notice_id=$1 AND stage='publication'",[ids[0]])).rows).toHaveLength(0);
  } finally {await client.query('ROLLBACK');client.release();await pool.end();}
 });
});
