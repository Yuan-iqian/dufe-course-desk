import catalogue from './campus-sources.json';
import {sha256} from './crypto.mjs';
import {officialURL} from './campus-core.mjs';
import {fetchOfficial,parseList,parseArticle} from './campus-parser.mjs';
export const sources=catalogue.sources;
export const disabledSources=catalogue.disabled;
export const byId=new Map(sources.map(s=>[s.id,s]));
const errorMessage=error=>String(error?.message||'采集失败').slice(0,180);

export async function crawlSource(db,source,now=Date.now(),fetcher=fetch) {
  const token=crypto.randomUUID();
  const claim=await db.prepare('UPDATE campus_sources SET lease_until=?,lease_token=? WHERE id=? AND lease_until<=? RETURNING failures').bind(now+90000,token,source.id,now).first();
  if(!claim)return {status:'busy',sourceId:source.id};
  try {
    let page=await fetchOfficial(source.url,fetcher),parsed=await parseList(page.html,source,page.url,now);
    if(!parsed.items.length&&parsed.redirect){const target=new URL(parsed.redirect,page.url).href;page=await fetchOfficial(target,fetcher);parsed=await parseList(page.html,source,page.url,now);}
    if(!parsed.items.length)throw Object.assign(new Error('页面已获取但没有解析到公告，需要检查来源规则'),{kind:'parse_zero'});
    const rows=await Promise.all(parsed.items.map(async item=>({ ...item,id:await sha256(`${source.id}\0${item.url}`)})));
    const statements=rows.map(item=>db.prepare(`INSERT INTO campus_notices(id,source_id,url,title,published_at,category,first_seen,updated_at,detail_status)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,url) DO UPDATE SET
      title=excluded.title, published_at=CASE WHEN campus_notices.detail_at IS NOT NULL OR excluded.published_at='' THEN campus_notices.published_at ELSE excluded.published_at END,
      category=excluded.category,
      revision=campus_notices.revision+CASE WHEN campus_notices.title<>excluded.title THEN 1 ELSE 0 END,
      updated_at=CASE WHEN campus_notices.title<>excluded.title THEN excluded.updated_at ELSE campus_notices.updated_at END,
      detail_status=CASE WHEN campus_notices.title<>excluded.title THEN 'pending' ELSE campus_notices.detail_status END,
      next_detail=CASE WHEN campus_notices.title<>excluded.title THEN 0 ELSE campus_notices.next_detail END`)
      .bind(item.id,source.id,item.url,item.title,item.publishedAt,item.category,now,now,!officialURL(item.url)?'offsite':item.publishedAt&&Date.parse(item.publishedAt)<now-90*86400000?'not_requested':'pending'));
    statements.push(db.prepare("UPDATE campus_sources SET status='ok',checked_at=?,success_at=?,next_scan=?,failures=0,lease_until=0,lease_token=NULL,error='',item_count=? WHERE id=? AND lease_token=?")
      .bind(now,now,now+source.intervalMinutes*60000,rows.length,source.id,token));
    await db.batch(statements);
    return {status:'ok',sourceId:source.id,count:rows.length};
  }catch(error) {
    const status=error.kind||(/timeout|abort/i.test(String(error))?'timeout':'error');
    await db.prepare('UPDATE campus_sources SET status=?,checked_at=?,next_scan=?,failures=failures+1,lease_until=0,lease_token=NULL,error=? WHERE id=? AND lease_token=?')
      .bind(status,now,now+Math.min(60,5*2**Math.min(claim.failures,4))*60000,errorMessage(error),source.id,token).run();
    return {status,sourceId:source.id,message:errorMessage(error)};
  }
}

export async function crawlDetail(db,notice,now=Date.now(),fetcher=fetch) {
  const source=byId.get(notice.source_id);
  if(!source||!officialURL(notice.url))return {status:'offsite'};
  const claimed=await db.prepare("UPDATE campus_notices SET next_detail=?,detail_status='pending' WHERE id=? AND next_detail<=? RETURNING id")
    .bind(now+120000,notice.id,now).first();
  if(!claimed)return {status:'busy'};
  try {
    const {html}=await fetchOfficial(notice.url,fetcher),parsed=await parseArticle(html,source,notice.published_at,now);
    if(!parsed.found)throw new Error('正文规则未匹配，请打开学校原文查看');
    const hash=await sha256(parsed.body),changed=notice.body_hash&&notice.body_hash!==hash;
    const status=parsed.body.length>25?'ready':'empty';
    await db.prepare(`UPDATE campus_notices SET summary=?,published_at=?,detail_status=?,detail_error='',detail_at=?,next_detail=?,body_hash=?,
      deadline=?,deadline_precision=?,deadline_evidence=?,revision=revision+?,updated_at=CASE WHEN ? THEN ? ELSE updated_at END WHERE id=?`)
      .bind(parsed.summary,parsed.publishedAt,status,now,now+7*86400000,hash,parsed.deadline?.value||null,parsed.deadline?.precision||null,parsed.deadline?.evidence||'',changed?1:0,changed?1:0,now,notice.id).run();
    return {status,id:notice.id};
  }catch(error) {
    await db.prepare("UPDATE campus_notices SET detail_status='error',detail_error=?,detail_at=?,next_detail=? WHERE id=?")
      .bind(errorMessage(error),now,now+3600000,notice.id).run();
    return {status:'error',id:notice.id,message:errorMessage(error)};
  }
}

export async function campusTick(env,now=Date.now()) {
  const db=env.DB,enabled=env.CAMPUS_SOURCE_IDS?sources.filter(s=>env.CAMPUS_SOURCE_IDS.split(',').includes(s.id)):sources;
  if(!enabled.length)return {status:'disabled'};
  const ids=enabled.map(s=>s.id),slots=ids.map(()=>'?').join(',');
  const due=await db.prepare(`SELECT id FROM campus_sources WHERE id IN (${slots}) AND next_scan<=? AND lease_until<=? ORDER BY next_scan,id LIMIT 1`).bind(...ids,now,now).first();
  if(due)return crawlSource(db,byId.get(due.id),now);
  // One bounded article task per tick. Source scans and large article batches never share an invocation.
  const notice=await db.prepare(`SELECT * FROM campus_notices WHERE source_id IN (${slots}) AND next_detail<=? AND (detail_status IN ('pending','error') OR (detail_status IN ('ready','empty') AND first_seen>=?)) ORDER BY CASE WHEN detail_status IN ('pending','error') THEN 0 ELSE 1 END,published_at DESC LIMIT 1`).bind(...ids,now,now-90*86400000).first();
  if(notice)return crawlDetail(db,notice,now);
  return {status:'idle'};
}
