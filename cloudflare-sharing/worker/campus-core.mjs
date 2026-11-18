// Source selectors and parsing rules adapted from 知财 / touxian (MIT).
// See ../../src/vendor/zhicai/LICENSE and CREDITS.md.
export const categories={academic:'教务考试',publicity:'公示评选',activity:'活动讲座',other:'其他通知'};
export const statuses={not_checked:'待检查',ok:'正常',empty:'暂无公告',parse_zero:'页面规则待适配',auth_required:'学校限制访问',timeout:'网络超时',error:'检查失败'};
export const clean=value=>String(value||'').replace(/[\s\u00a0]+/g,' ').trim();
export function officialURL(value) {
  try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||['80','443'].includes(u.port))&&(u.hostname==='dufe.edu.cn'||u.hostname.endsWith('.dufe.edu.cn'));}catch{return false;}
}
export function safeLink(value,base) {
  try {const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';u.hash='';return u.href;}catch{return '';}
}
export const chinaDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
function validDate(y,m,d) {
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'';
}
export function listDate(raw,now=Date.now()) {
  const value=clean(raw),full=value.match(/(20\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})/);
  if(full)return validDate(+full[1],+full[2],+full[3]);
  const short=value.match(/(?:^|\D)(\d{1,2})\s*[月.\/-]\s*(\d{1,2})(?:日|$|\D)/);
  if(!short)return '';
  let year=+chinaDate(now).slice(0,4),date=validDate(year,+short[1],+short[2]);
  if(date>chinaDate(now))date=validDate(year-1,+short[1],+short[2]);return date;
}
export function categoryOf(title) {
  if(/公示|奖学金|评选|获奖|评审结果/.test(title))return 'publicity';
  if(/考试|选课|课程|教务|学籍|答辩|学位|推免|转专业|成绩|教材|教学|毕业|四六级/.test(title))return 'academic';
  if(/活动|讲座|论坛|竞赛|比赛|讲坛|培训|讲堂|年会|会议/.test(title))return 'activity';return 'other';
}
export function normalizeItems(items,source,base,now) {
  const found=new Map();let previousDate=chinaDate(now);
  for(const item of items){
    const url=safeLink(item.href,base);let title=clean(item.titleAttr||item.title);
    const raw=clean(item.date);if(raw&&title.endsWith(raw))title=title.slice(0,-raw.length).replace(/[\s|｜—-]+$/,'');
    if(!item.href||!url||!title||/^(首页|上一页|下一页|更多|通知公告)$/.test(title))continue;
    let publishedAt=listDate(raw,now);
    if(publishedAt&&!/20\d{2}/.test(raw)&&publishedAt>previousDate){const rolled=String(+publishedAt.slice(0,4)-1)+publishedAt.slice(4);if(rolled<=previousDate)publishedAt=rolled;}
    if(publishedAt)previousDate=publishedAt;
    found.set(url,{url,title:title.slice(0,260),publishedAt,category:categoryOf(title),sourceId:source.id});
  }
  return [...found.values()].slice(0,30);
}
export function extractDeadline(text,published='',now=Date.now()) {
  const anchor=published||chinaDate(now),candidates=[];
  const pattern=/(?:(20\d{2})\s*[年.\/-]\s*)?(\d{1,2})\s*[月.\/-]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：](\d{2}))?/g;
  for(const match of text.matchAll(pattern)) {
    const start=match.index,end=start+match[0].length;
    const before=text.slice(Math.max(0,start-30),start),after=text.slice(end,end+45);
    // Attach action cues to this date; a date elsewhere in the paragraph is not enough.
    const deadline=/(?:截止|截至)(?:时间)?(?:为|到|至|于|是|：|:|\s)*$/.test(before)
      || /^(?:\s*前|\s*之前|\s*以前)(?:[，,]?\s*)(?:.{0,24})(?:提交|上传|反馈|报送|填写|完成|报名|申请|缴费|发送|交至|交到)/.test(after)
      || /(?:报名|申请|提交|公示)(?:时间|期限|期)[^。；;]{0,25}(?:至|到|—|~|-)\s*$/.test(before)
      || /^(?:\s*截止|\s*[，,]?\s*逾期)/.test(after);
    if(!deadline)continue;
    let year=+(match[1]||anchor.slice(0,4)),month=+match[2],day=+match[3];
    if(!match[1]&&month<+anchor.slice(5,7)-6)year++;
    const date=validDate(year,month,day);if(!date)continue;
    let value=date,precision='date';
    if(match[4]!==undefined){if(+match[4]>23||+match[5]>59)continue;value+=`T${match[4].padStart(2,'0')}:${match[5]}+08:00`;precision='minute';}
    candidates.push({value,precision,evidence:clean(text.slice(Math.max(0,start-35),Math.min(text.length,end+65))).slice(0,180)});
  }
  candidates.sort((a,b)=>a.value.localeCompare(b.value));return candidates[0]||null;
}
export function validateOverride(value) {
  if(value===null||value==='')return value;
  if(typeof value!=='string')throw new Error('截止时间格式不正确');
  const m=value.match(/^(20\d{2})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if(!m||!validDate(+m[1],+m[2],+m[3])||(m[4]!==undefined&&(+m[4]>23||+m[5]>59)))throw new Error('请选择有效的截止日期和时间');
  return value+(m[4]===undefined?'':'+08:00');
}
