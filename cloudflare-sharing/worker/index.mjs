import {handleCampus} from './campus-api.mjs';
import {campusTick} from './campus-crawler.mjs';
const security={
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; form-action 'none'",
  'cache-control':'no-store'
};
export default {
  async scheduled(controller,env,ctx) { const result=await campusTick(env);console.log('campus-scheduled',JSON.stringify(result)); },
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    let response;
    try {
      if(url.protocol==='http:'&&!local){url.protocol='https:';response=Response.redirect(url.href,308);}
      else if(url.pathname==='/healthz') response=Response.json({ok:true,service:'course-desk-campus',version:'0.7.0'});
      else if(request.method==='GET'&&['/api/campus/overview','/api/campus/feed','/api/campus/notice'].includes(url.pathname)) {
        const headers=new Headers(request.headers);headers.delete('authorization');
        response=await handleCampus(new Request(request,{headers}),env,ctx);
      }
      else if(url.pathname.startsWith('/api/'))response=Response.json({ok:false,message:'此入口已停用，请使用新版客户端'},{status:410});
      else response=new Response(request.method==='HEAD'?null:'课程事务提醒已改为电脑与手机客户端。此地址仅提供校园公告同步服务。',{status:410,headers:{'content-type':'text/plain; charset=utf-8'}});
    }catch {
      response=Response.json({ok:false,message:'校园公告暂时不可用，请稍后重试'},{status:500});
    }
    const headers=new Headers(response.headers);for(const [key,value] of Object.entries(security))headers.set(key,value);
    if(!local)headers.set('strict-transport-security','max-age=31536000');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
};
