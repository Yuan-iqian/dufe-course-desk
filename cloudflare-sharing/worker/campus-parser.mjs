import {clean,normalizeItems,listDate,extractDeadline,officialURL} from './campus-core.mjs';

export async function parseList(html,source,finalURL,now=Date.now()) {
  const rows=[];let current=null,base=finalURL,redirect='',script='';const s=source.list;
  const rewriter=new HTMLRewriter()
    .on('base[href]',{element(el){const candidate=new URL(el.getAttribute('href'),finalURL).href;if(officialURL(candidate))base=candidate;}})
    .on('meta[http-equiv]',{element(el){if(el.getAttribute('http-equiv')?.toLowerCase()==='refresh')redirect=el.getAttribute('content')?.match(/url\s*=\s*['"]?([^'";]+)/i)?.[1]||'';}})
    .on('script',{text(chunk){if(script.length<16000)script+=chunk.text;}})
    .on(s.item,{element(){current={title:'',titleAttr:'',href:'',date:''};rows.push(current);}})
    .on(`${s.item} ${s.link}`,{element(el){if(!current||current.href)return;current.href=el.getAttribute('href')||'';current.titleAttr=s.title_attr?el.getAttribute(s.title_attr)||'':'';},text(chunk){if(current&&!s.title)current.title+=chunk.text;}});
  if(s.title)rewriter.on(`${s.item} ${s.title}`,{text(chunk){if(current)current.title+=chunk.text;}});
  if(s.date)rewriter.on(`${s.item} ${s.date}`,{text(chunk){if(current)current.date+=chunk.text;}});
  await rewriter.transform(new Response(html)).arrayBuffer();
  redirect ||= script.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/)?.[1]||'';
  return {items:normalizeItems(rows,source,base,now),redirect};
}

export async function parseArticle(html,source,published,now=Date.now()) {
  const a=source.article;let body='',date='',ignore=0,found=false;
  const rewriter=new HTMLRewriter().on(`${a.content_selector}`,{element(){found=true;},text(chunk){if(!ignore&&body.length<50000)body+=chunk.text;}})
    .on('script,style,noscript',{element(el){ignore++;el.onEndTag(()=>{ignore--;});}})
    .on(`${a.content_selector} p, ${a.content_selector} br, ${a.content_selector} li`,{element(){body+='\n';}});
  if(a.date_selector)rewriter.on(a.date_selector,{text(chunk){if(date.length<300)date+=chunk.text;}});
  await rewriter.transform(new Response(html)).arrayBuffer();
  const fullDate=/20\d{2}[年.\/-]/.test(date)?listDate(date,now):'';
  const publishedAt=fullDate||published;
  return {body:clean(body),summary:clean(body).slice(0,4000),publishedAt,deadline:extractDeadline(body,publishedAt,now),found};
}

export async function fetchOfficial(url,fetcher=fetch) {
  let current=url;
  for(let hop=0;hop<4;hop++) {
    if(!officialURL(current))throw Object.assign(new Error('来源跳转到站外，已停止采集'),{kind:'error'});
    const response=await fetcher(current,{redirect:'manual',headers:{'User-Agent':'CourseDesk/0.6 PublicNoticeReader','Accept':'text/html','Referer':new URL(current).origin+'/'},signal:AbortSignal.timeout(18000)});
    if(response.status>=300&&response.status<400){const next=response.headers.get('location');if(!next)throw new Error('学校页面跳转缺少地址');current=new URL(next,current).href;continue;}
    if([401,403,429].includes(response.status))throw Object.assign(new Error(`学校暂不允许读取（${response.status}），稍后重试`),{kind:'auth_required'});
    if(!response.ok)throw new Error(`学校页面返回 ${response.status}`);
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw new Error('页面超过采集大小限制');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const html=new TextDecoder('utf-8').decode(bytes);
    if(/(?:统一身份认证|请输入验证码|访问验证)/.test(html)&&!/<(?:article|ul|div)[^>]+class=["'][^"']*(?:news|article|s-List)/i.test(html))throw Object.assign(new Error('页面需要学校访问验证'),{kind:'auth_required'});
    return {html,url:current};
  }
  throw new Error('学校页面连续跳转，暂未读取');
}
