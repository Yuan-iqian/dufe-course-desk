import {sha256} from './crypto.mjs';
import {sources,disabledSources,byId,crawlDetail,campusTick} from './campus-crawler.mjs';
import {categories,statuses,chinaDate,validateOverride} from './campus-core.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const send=(data,status=200)=>Response.json({ok:true,data},{status});
const rows=async statement=>(await statement.all()).results;
const unreadSQL='CASE WHEN u.read_revision IS NOT NULL THEN u.read_revision<n.revision ELSE n.updated_at>? END';
const joinedSQL='FROM campus_notices n LEFT JOIN campus_user_state u ON u.notice_id=n.id AND u.user_id=?';
function view(row,prefs) {
  return {id:row.id,sourceId:row.source_id,url:row.url,title:row.title,publishedAt:row.published_at,category:row.category,
    firstSeen:row.first_seen,updatedAt:row.updated_at,revision:row.revision,summary:row.summary,
    detailStatus:row.detail_status,detailError:row.detail_error,detailAt:row.detail_at,
    deadline:row.deadline_override!==null&&row.deadline_override!==undefined?row.deadline_override:row.deadline,
    detectedDeadline:row.deadline,deadlineEvidence:row.deadline_evidence,deadlineConfirmed:!!row.deadline_confirmed,
    completed:!!row.completed,read:!prefs||!(row.read_revision!==null&&row.read_revision!==undefined?row.read_revision<row.revision:row.updated_at>prefs.baseline_at)};
}
async function userFor(request,db,now) {
  const header=request.headers.get('authorization');if(!header)return null;
  const token=/^Bearer ([a-f0-9]{64})$/.exec(header)?.[1];if(!token)fail('请重新登录账号',401);
  const session=await db.prepare("SELECT payload FROM sharing_records WHERE kind='sessions' AND id=?").bind(await sha256(token)).first();
  const value=session?JSON.parse(session.payload):null;if(!value||value.expiresAt<=now)fail('账号登录已过期，请重新登录',401);
  const user=await db.prepare("SELECT id FROM sharing_records WHERE kind='users' AND id=?").bind(value.userId).first();
  if(!user)fail('账号不存在，请重新登录',401);return user.id;
}
async function bodyFor(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail('请求格式不正确',415);
  const reader=request.body?.getReader();if(!reader)fail('请求内容为空');const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail('请求内容过长',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('请求格式不正确');return value;}catch{fail('请求格式不正确');}
}
function preferenceView(prefs) {return prefs?{sources:JSON.parse(prefs.sources),keywords:prefs.keywords,notifications:!!prefs.notifications}:null;}
function filters(params,userId,prefs,now) {
  const where=[],args=[];const source=params.get('source')||'',category=params.get('category')||'',query=(params.get('q')||'').slice(0,100),scope=params.get('view')||'all';
  if(source){if(!byId.has(source))fail('来源不存在',404);where.push('n.source_id=?');args.push(source);}
  if(category){if(!categories[category])fail('分类不存在');where.push('n.category=?');args.push(category);}
  if(query){where.push('(n.title LIKE ? ESCAPE \'\\\' OR n.summary LIKE ? ESCAPE \'\\\')');const match='%'+query.replace(/[\\%_]/g,'\\$&')+'%';args.push(match,match);}
  const range=params.get('range')||'30';if(!['all','7','30'].includes(range))fail('日期范围不正确');
  if(range!=='all'){where.push('n.published_at>=?');args.push(chinaDate(now-Number(range)*86400000));}
  if(['following','unread','completed'].includes(scope)&&!userId)fail('登录后查看自己的关注和阅读状态',401);
  if(scope==='following') {
    const followed=JSON.parse(prefs.sources);where.push(followed.length?`n.source_id IN (${followed.map(()=>'?').join(',')})`:'0');args.push(...followed);
    const words=prefs.keywords.split(/[，,\n]/).map(s=>s.trim()).filter(Boolean);
    if(words.length){where.push('('+words.map(()=>"n.title LIKE ? ESCAPE '\\'").join(' OR ')+')');args.push(...words.map(w=>'%'+w.replace(/[\\%_]/g,'\\$&')+'%'));}
  }else if(scope==='unread'){where.push(`(${unreadSQL})=1`);args.push(prefs.baseline_at);}
  else if(scope==='completed')where.push('u.completed=1');
  else if(scope!=='all')fail('筛选项不正确');
  return {where:where.length?'WHERE '+where.join(' AND '):'',args};
}

export async function handleCampus(request,env,ctx={},clock=Date.now) {
  const now=clock(),url=new URL(request.url),operation=url.pathname.slice('/api/campus/'.length);
  const db=env.DB.withSession?env.DB.withSession('first-primary'):env.DB;
  try {
    const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail('不允许跨站请求',403);
    if (request.method === 'GET' && operation === 'feed') {
      const cursor = url.searchParams.get('cursor') || '';
      if (cursor && !/^\d{1,16}:[a-f0-9]{0,64}$/.test(cursor)) fail('同步位置无效');
      const [stamp = '0', afterId = ''] = cursor.split(':');
      const effective = 'MAX(updated_at,COALESCE(detail_at,0))';
      const items = await rows(db.prepare(`SELECT *,${effective} AS changed_at FROM campus_notices WHERE (${effective}>? OR (${effective}=? AND id>?)) ORDER BY changed_at,id LIMIT 201`).bind(Number(stamp),Number(stamp),afterId));
      const visible = items.slice(0, 200);
      const last = visible.at(-1);
      return send({items:visible.map(item=>view(item,null)),cursor:last?`${last.changed_at}:${last.id}`:cursor,more:items.length>200});
    }
    const userId=await userFor(request,db,now);let prefs=null;
    if(userId) {
      prefs=await db.prepare('SELECT * FROM campus_preferences WHERE user_id=?').bind(userId).first();
      if(!prefs){await db.prepare('INSERT INTO campus_preferences(user_id,baseline_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING').bind(userId,now).run();prefs=await db.prepare('SELECT * FROM campus_preferences WHERE user_id=?').bind(userId).first();}
    }
    if(request.method==='GET'&&operation==='overview') {
      const [health,total,counts]=await Promise.all([
        rows(db.prepare('SELECT * FROM campus_sources')),
        db.prepare('SELECT COUNT(*) AS total FROM campus_notices').first(),
        userId?db.prepare(`SELECT COALESCE(SUM(${unreadSQL}),0) AS unread,COALESCE(SUM(u.completed),0) AS completed ${joinedSQL}`).bind(prefs.baseline_at,userId).first():Promise.resolve({unread:0,completed:0})
      ]);
      return send({sources:sources.map(s=>{const h=health.find(x=>x.id===s.id)||{};return {id:s.id,name:s.name,url:s.url,intervalMinutes:s.intervalMinutes,status:h.lease_until>now?'checking':h.status||'not_checked',statusLabel:h.lease_until>now?'检查中':statuses[h.status]||'待检查',checkedAt:h.checked_at||null,successAt:h.success_at||null,error:h.error||'',count:h.item_count||0};}),disabledSources,categories,summary:{total:total.total,...counts},preferences:preferenceView(prefs),authenticated:!!userId,serverTime:now});
    }
    if(request.method==='GET'&&operation==='notices') {
      const page=Math.max(1,Math.min(1000,parseInt(url.searchParams.get('page')||'1',10)||1)),size=20;
      const f=filters(url.searchParams,userId,prefs,now),bindings=[userId||'',...f.args];
      const [items,count]=await Promise.all([
        rows(db.prepare(`SELECT n.*,u.read_revision,u.completed,u.deadline_override,u.deadline_confirmed ${joinedSQL} ${f.where} ORDER BY n.published_at DESC,n.first_seen DESC,n.id DESC LIMIT ? OFFSET ?`).bind(...bindings,size,(page-1)*size)),
        db.prepare(`SELECT COUNT(*) AS total ${joinedSQL} ${f.where}`).bind(...bindings).first()
      ]);
      return send({items:items.map(n=>view(n,prefs)),total:count.total,page,pageSize:size});
    }
    if(request.method==='GET'&&operation==='notice') {
      const id=url.searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id||''))fail('公告编号不正确');
      const item=await db.prepare(`SELECT n.*,u.read_revision,u.completed,u.deadline_override,u.deadline_confirmed ${joinedSQL} WHERE n.id=?`).bind(userId||'',id).first();
      if(!item)fail('公告不存在',404);
      if(item.detail_status!=='offsite'&&item.next_detail<=now){const promise=crawlDetail(db,item,now);if(ctx.waitUntil)ctx.waitUntil(promise);else await promise;}
      return send({notice:view(item,prefs)});
    }
    if(request.method==='GET'&&operation==='alerts') {
      if(!userId)fail('请先登录账号',401);
      const since=Number(url.searchParams.get('since')),afterId=url.searchParams.get('afterId')||'';if(!Number.isFinite(since)||!/^([a-f0-9]{64})?$/.test(afterId))fail('检查时间不正确');
      if(!prefs.notifications)return send({items:[],serverTime:now});
      const p=new URLSearchParams({view:'following',range:'all'}),f=filters(p,userId,prefs,now);
      const start=Math.max(since,prefs.baseline_at);
      const items=await rows(db.prepare(`SELECT n.*,u.read_revision,u.completed,u.deadline_override,u.deadline_confirmed ${joinedSQL} ${f.where} AND (n.updated_at>? OR (n.updated_at=? AND n.id>?)) AND n.updated_at<=? AND (${unreadSQL})=1 AND COALESCE(u.completed,0)=0 ORDER BY n.updated_at ASC,n.id ASC LIMIT 51`)
        .bind(userId,...f.args,start,start,since>=prefs.baseline_at?afterId:'',now,prefs.baseline_at));
      // Keep a cursor only after a complete batch; overlap + client revision dedupe handles ties.
      const more=items.length>50,visible=items.slice(0,50),cursor=more?visible.at(-1).updated_at:now;
      return send({items:visible.map(n=>view(n,prefs)),serverTime:cursor,afterId:more?visible.at(-1).id:'',more});
    }
    if(request.method!=='POST')fail('接口不存在',404);
    if(!userId)fail('登录后才能保存个人状态',401);
    const body=await bodyFor(request);
    if(operation==='preferences') {
      if(!Array.isArray(body.sources)||body.sources.length>sources.length||body.sources.some(id=>!byId.has(id)))fail('请选择有效来源');
      if(typeof body.keywords!=='string'||body.keywords.length>120||body.keywords.split(/[，,\n]/).filter(Boolean).length>10)fail('关键词最多 10 个、总长 120 字');
      if(typeof body.notifications!=='boolean')fail('提醒设置不正确');
      await db.prepare('UPDATE campus_preferences SET sources=?,keywords=?,notifications=? WHERE user_id=?').bind(JSON.stringify([...new Set(body.sources)]),body.keywords.trim(),Number(body.notifications),userId).run();
      return send({saved:true});
    }
    if(operation==='state') {
      const notice=await db.prepare('SELECT id,revision FROM campus_notices WHERE id=?').bind(String(body.id||'')).first();if(!notice)fail('公告不存在',404);
      if(!['read','completed','deadline'].includes(body.field))fail('不支持的状态');
      let sql,values;
      if(body.field==='read'||body.field==='completed') {
        if(typeof body.value!=='boolean')fail('状态值不正确');const column=body.field==='read'?'read_revision':'completed';
        sql=`INSERT INTO campus_user_state(user_id,notice_id,${column},updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,notice_id) DO UPDATE SET ${column}=excluded.${column},updated_at=excluded.updated_at`;
        values=[userId,notice.id,body.field==='read'?(body.value?notice.revision:0):Number(body.value),now];
      }else{
        let deadline;try{deadline=validateOverride(body.value);}catch(error){fail(error.message);}
        sql='INSERT INTO campus_user_state(user_id,notice_id,deadline_override,deadline_confirmed,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,notice_id) DO UPDATE SET deadline_override=excluded.deadline_override,deadline_confirmed=excluded.deadline_confirmed,updated_at=excluded.updated_at';
        values=[userId,notice.id,deadline,deadline===null?0:1,now];
      }
      await db.prepare(sql).bind(...values).run();return send({saved:true});
    }
    if(operation==='refresh') {
      const id=body.sourceId;if(id&&!byId.has(id))fail('来源不存在');
      const selected=id?[id]:sources.map(s=>s.id);
      const result=await db.prepare(`UPDATE campus_sources SET next_scan=MIN(next_scan,?) WHERE id IN (${selected.map(()=>'?').join(',')}) AND (checked_at IS NULL OR checked_at<?) AND lease_until<=?`)
        .bind(now,...selected,now-5*60000,now).run();
      if(result.meta.changes){const task=campusTick({...env,DB:db},now);if(ctx.waitUntil)ctx.waitUntil(task);else await task;}
      return send({queued:result.meta.changes,message:result.meta.changes?'已安排后台检查，各来源会依次更新':'最近 5 分钟已检查，请稍后刷新查看'});
    }
    fail('接口不存在',404);
  }catch(error){return Response.json({ok:false,message:error.status?error.message:'校园通知暂时无法读取，请稍后重试'},{status:error.status||500});}
}
