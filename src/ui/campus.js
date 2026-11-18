(() => {
  'use strict';
  const root=document.getElementById('campus-panel');if(!root)return;
  const $=id=>document.getElementById(id),desktop=!!window.reminder;
  const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(label,fn,cls='btn btn-light')=>{const b=el('button',label,cls);b.type='button';b.addEventListener('click',fn);return b;};
  const fmt=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'尚未成功';
  const deadline=value=>value?value.replace('T',' ').replace('+08:00',''):'未发现明确期限';
  root.innerHTML=`
    <div class="cp-heading"><div><h2>校园通知</h2><p id="cp-summary" class="muted" role="status">正在读取学校公开通知</p></div><div class="cp-actions"><button id="cp-settings" class="btn btn-outline-secondary" type="button">我的关注</button><button id="cp-refresh" class="btn btn-primary" type="button">检查新通知</button></div></div>
    <div id="cp-error" class="error-banner" role="alert" hidden></div><div id="cp-message" class="notice" role="status" hidden></div>
    <section id="cp-auth" class="cp-auth"><p>登录学校后使用个人关注、阅读记录和提醒</p><button id="cp-school-login" class="btn btn-primary" type="button">登录学校</button></section>
    <div id="cp-identity" class="cp-identity" hidden><span id="cp-user"></span><button id="cp-logout" class="text-button" type="button">退出账号</button></div>
    <div class="cp-filters"><div class="cp-search"><label for="cp-query" class="form-label">搜索通知</label><input id="cp-query" class="form-control" type="search" maxlength="100" placeholder="搜索标题或正文"></div><div><label for="cp-source" class="form-label">通知来源</label><select id="cp-source" class="form-select"><option value="">全部来源</option></select></div><div><label for="cp-category" class="form-label">分类</label><select id="cp-category" class="form-select"><option value="">全部分类</option></select></div><div><label for="cp-range" class="form-label">发布日期</label><select id="cp-range" class="form-select"><option value="30">近 30 天</option><option value="7">近 7 天</option><option value="all">全部记录</option></select></div></div>
    <div class="cp-viewbar"><nav class="cp-tabs" aria-label="通知筛选"><button data-cp-view="all" class="selected" type="button" aria-pressed="true">全部通知</button><button data-cp-view="following" type="button" aria-pressed="false">我关注的</button><button data-cp-view="unread" type="button" aria-pressed="false">未读</button><button data-cp-view="completed" type="button" aria-pressed="false">已完成</button></nav><span id="cp-count" class="muted"></span></div>
    <div id="cp-list" class="cp-list" aria-live="polite"></div>
    <div class="cp-pagination"><button id="cp-prev" class="btn btn-light" type="button">上一页</button><span id="cp-page">第 1 页</span><button id="cp-next" class="btn btn-light" type="button">下一页</button></div>
    <details class="cp-health"><summary>来源运行状态 <span id="cp-health-count"></span></summary><p class="muted">教务处、学生工作部约每 15 分钟检查，其余来源约每小时检查；故障时逐步重试</p><div id="cp-health-list"></div></details>
    <dialog id="cp-detail" aria-labelledby="cp-detail-title" class="cp-dialog"><div class="cp-dialog-head"><h2 id="cp-detail-title">通知详情</h2><button id="cp-detail-close" class="btn btn-light" type="button">关闭</button></div><div id="cp-detail-body"></div></dialog>
    <dialog id="cp-preferences" aria-labelledby="cp-preferences-title" class="cp-dialog"><div class="cp-dialog-head"><h2 id="cp-preferences-title">我的关注</h2><button id="cp-preferences-close" class="btn btn-light" type="button">关闭</button></div><form id="cp-preferences-form"><fieldset><legend>关注的通知来源</legend><div id="cp-follow-sources" class="cp-follow-sources"></div></fieldset><label for="cp-keywords" class="form-label">标题关键词（可选）</label><input id="cp-keywords" class="form-control" maxlength="120" placeholder="例如：奖学金，报名，考试"><p class="muted">用逗号分隔，匹配任意一个；留空显示关注来源的全部通知</p><label class="cp-check"><input id="cp-notifications" type="checkbox">接收关注来源的新公告提醒</label><p class="muted">使用学校账号保存关注设置，应用运行时检查新公告</p><div id="cp-preferences-error" role="alert" class="cp-form-error"></div><button id="cp-preferences-save" class="btn btn-primary" type="submit">保存关注</button></form></dialog>`;
  let overview=null,page=1,view='all',listGeneration=0,busy=false,identity='',detailId='',detailTimer=null,searchTimer,visible=root.hidden===false;
  const service=()=>window.courseService;
  const user=()=>service()?.snapshot().user;
  function message(text,error=false){const n=$(error?'cp-error':'cp-message');n.textContent=text;n.hidden=!text;}
  function requireLogin(){if(user())return true;$('cp-school-login').focus();message('请先在学校窗口完成登录');return false;}
  function openLink(link,label) {
    const a=el('a',label,'cp-original');a.href=link;a.target='_blank';a.rel='noopener noreferrer';
    if(desktop)a.addEventListener('click',async e=>{e.preventDefault();const r=await window.reminder.invoke('open-campus-source',link);if(!r.ok)message(r.message,true);});return a;
  }
  async function mutation(path,body){if(!requireLogin())return false;await service().request(path,body);return true;}
  async function perform(fn,success=''){if(busy)return;busy=true;message('',true);try{await fn();if(success)message(success);}catch(error){message(error.message,true);}finally{busy=false;}}
  async function refreshOverview(){
    const expected=identity,next=await service().request('overview');if(identity!==expected)return false;overview=next;
    const {sources,summary}=overview,healthy=sources.filter(s=>s.status==='ok').length,errors=sources.filter(s=>!['ok','not_checked','checking'].includes(s.status));
    $('cp-summary').textContent=`${summary.total} 条已收录 · ${healthy}/${sources.length} 个来源正常`+(user()?` · ${summary.unread} 条未读`:'');
    $('cp-auth').hidden=!!user();$('cp-identity').hidden=!user();$('cp-user').textContent=user()?`${user().nickname} · 此设备的个人记录`:'';
    if(!$('cp-source').dataset.loaded){for(const s of sources){const option=el('option',s.name);option.value=s.id;$('cp-source').append(option);}for(const [id,label] of Object.entries(overview.categories)){const option=el('option',label);option.value=id;$('cp-category').append(option);}$('cp-source').dataset.loaded='1';}
    $('cp-health-count').textContent=errors.length?`· ${errors.length} 个来源需关注`:'· '+healthy+' 个来源正常';
    const health=sources.map(s=>{const row=el('div','','cp-source-state');row.append(el('strong',s.name),el('span',s.statusLabel,s.status==='ok'?'':'cp-source-warning'),el('span','上次成功 '+fmt(s.successAt),'muted'));if(s.error)row.append(el('p',s.error,'cp-source-warning'));return row;});
    for(const s of overview.disabledSources){const row=el('div','','cp-source-state');row.append(el('strong',s.name),el('span','尚未接入','cp-source-warning'),el('p',s.reason,'muted'));health.push(row);}
    $('cp-health-list').replaceChildren(...health);
    return true;
  }
  async function loadList(){
    const gen=++listGeneration;
    const params=new URLSearchParams({page:String(page),view,source:$('cp-source').value,category:$('cp-category').value,range:$('cp-range').value,q:$('cp-query').value});
    $('cp-list').setAttribute('aria-busy','true');
    try{
      const result=await service().request('notices?'+params);if(gen!==listGeneration)return;
      $('cp-count').textContent=`${result.total} 条匹配`;$('cp-page').textContent=`第 ${page} / ${Math.max(1,Math.ceil(result.total/result.pageSize))} 页`;
      $('cp-prev').disabled=page<=1;$('cp-next').disabled=page*result.pageSize>=result.total;
      const cards=result.items.map(n=>{
        const card=el('article','','cp-card'+(n.read?'':' cp-unread')),top=el('div','','cp-card-meta');
        top.append(el('span',overview?.sources.find(s=>s.id===n.sourceId)?.name||n.sourceId),el('time',n.publishedAt||'发布日期未知'));if(!n.read)top.append(el('span','未读','cp-badge'));
        const title=button(n.title,()=>openDetail(n.id),'cp-title');
        const bottom=el('div','','cp-card-bottom');bottom.append(el('span',overview?.categories[n.category]||'其他通知','cp-category'));
        if(n.deadline)bottom.append(el('span',`${n.deadlineConfirmed?'已确认期限':'候选期限'} ${deadline(n.deadline)}`,'cp-deadline'));
        if(n.completed)bottom.append(el('span','已完成','cp-completed'));
        else if(n.detailStatus==='pending')bottom.append(el('span','正文待解析','muted'));
        card.append(top,title,bottom);return card;
      });
      if(!cards.length){const empty=el('div','','cp-empty');empty.append(el('h3',view==='unread'?'暂时没有未读通知':'没有匹配的通知'),el('p',view==='following'?'可以修改关注来源或关键词，也可以切换到全部通知':'试试放宽日期或筛选条件；来源检查失败时可在下方查看原因','muted'));cards.push(empty);}
      $('cp-list').replaceChildren(...cards);
    }finally{if(gen===listGeneration)$('cp-list').removeAttribute('aria-busy');}
  }
  async function refresh(){if(!service()?.snapshot().url)return;try{if(await refreshOverview())await loadList();message('',true);}catch(error){message(error.message,true);}}
  function closeDialog(dialog){clearTimeout(detailTimer);detailTimer=null;dialog.classList.add('cp-leaving');setTimeout(()=>{dialog.close();dialog.classList.remove('cp-leaving');if(dialog.id==='cp-detail')detailId='';},100);}
  function detailRender(n){
    $('cp-detail-title').textContent=n.title;const body=$('cp-detail-body'),nodes=[];
    nodes.push(el('p',`${overview?.sources.find(s=>s.id===n.sourceId)?.name||n.sourceId} · ${n.publishedAt||'日期未知'}`,'muted'));
    const actions=el('div','','cp-actions');actions.append(openLink(n.url,'打开学校原文'));
    if(user()){
      actions.append(button(n.read?'标为未读':'标为已读',()=>perform(async()=>{await mutation('state',{id:n.id,field:'read',value:!n.read});await openDetail(n.id,false);await refresh();})));
      actions.append(button(n.completed?'撤销完成':'标记完成',()=>perform(async()=>{await mutation('state',{id:n.id,field:'completed',value:!n.completed});await openDetail(n.id,false);await refresh();}),'btn btn-outline-secondary'));
    }
    nodes.push(actions);
    if(n.detailStatus==='ready'){nodes.push(el('h3','正文摘录'),el('p',n.summary,'cp-body-text'));}
    else {const labels={pending:'正文正在后台读取，完成后会自动更新',not_requested:'已安排正文读取，稍后自动更新',offsite:'这条通知指向站外内容，请打开原文阅读',empty:'正文可能是图片或附件，请打开学校原文核对',error:n.detailError||'正文暂时读取失败，请查看学校原文'};nodes.push(el('p',labels[n.detailStatus]||'正文尚未读取','cp-detail-note'));}
    nodes.push(el('h3','截止日期'),el('p',deadline(n.deadline)+(n.deadline?(n.deadlineConfirmed?' · 已由你确认':' · 自动提取，待核对'):''),'cp-deadline'));
    if(n.deadlineEvidence)nodes.push(el('blockquote',n.deadlineEvidence,'cp-evidence'));
    if(user()){
      const form=el('form','','cp-deadline-form'),label=el('label','手动确认或修改期限','form-label');label.htmlFor='cp-deadline-value';
      const input=el('input');input.id='cp-deadline-value';input.type='date';input.className='form-control';input.value=n.deadline?.slice(0,10)||'';
      const timeLabel=el('label','具体时间（可选）','form-label');timeLabel.htmlFor='cp-deadline-time';const time=el('input');time.id='cp-deadline-time';time.type='time';time.className='form-control';time.value=n.deadline?.includes('T')?n.deadline.slice(11,16):'';
      const save=el('button','保存我的期限','btn btn-outline-secondary');save.type='submit';const error=el('p','','cp-form-error');error.setAttribute('role','alert');
      form.append(label,input,timeLabel,time,el('p','使用北京时间；只填日期会保留“具体时刻未知”，日期留空表示没有截止期限','muted'),save,button('恢复自动提取',()=>perform(async()=>{await mutation('state',{id:n.id,field:'deadline',value:null});await openDetail(n.id,false);await loadList();})),error);
      form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await mutation('state',{id:n.id,field:'deadline',value:input.value+(input.value&&time.value?'T'+time.value:'')});await openDetail(n.id,false);await loadList();}catch(err){error.textContent=err.message;}finally{save.disabled=false;}});nodes.push(form);
    }
    body.replaceChildren(...nodes);
  }
  async function openDetail(id,markRead=true){
    detailId=id;const expected=identity;clearTimeout(detailTimer);const dialog=$('cp-detail');if(!dialog.open){$('cp-detail-title').textContent='正在读取通知';$('cp-detail-body').replaceChildren();dialog.showModal();}
    try{
      const data=await service().request('notice?id='+encodeURIComponent(id));if(detailId!==id||!dialog.open||expected!==identity)return;
      if(markRead&&user()&&!data.notice.read){await mutation('state',{id,field:'read',value:true});data.notice.read=true;void refresh();}
      if(detailId!==id||!dialog.open||expected!==identity)return;
      detailRender(data.notice);
      if(['pending','not_requested'].includes(data.notice.detailStatus))detailTimer=setTimeout(()=>openDetail(id,false),5000);
    }catch(error){$('cp-detail-body').replaceChildren(el('p',error.message,'cp-form-error'));}
  }
  function showPreferences(){
    if(!requireLogin()||!overview?.preferences)return;
    const prefs=overview.preferences;$('cp-follow-sources').replaceChildren(...overview.sources.map(s=>{const label=el('label','','cp-check');const input=el('input');input.type='checkbox';input.value=s.id;input.checked=prefs.sources.includes(s.id);label.append(input,el('span',s.name));return label;}));
    $('cp-keywords').value=prefs.keywords;$('cp-notifications').checked=prefs.notifications;$('cp-preferences-error').textContent='';$('cp-preferences').showModal();
  }
  $('cp-preferences-form').addEventListener('submit',async e=>{e.preventDefault();$('cp-preferences-save').disabled=true;try{await mutation('preferences',{sources:[...document.querySelectorAll('#cp-follow-sources input:checked')].map(n=>n.value),keywords:$('cp-keywords').value,notifications:$('cp-notifications').checked});closeDialog($('cp-preferences'));await refresh();message('关注设置已保存');}catch(error){$('cp-preferences-error').textContent=error.message;}finally{$('cp-preferences-save').disabled=false;}});
  $('cp-school-login').addEventListener('click',()=>perform(()=>service().login()));
  $('cp-logout').addEventListener('click',async()=>{$('cp-logout').disabled=true;try{await service().logout();view='all';setViewButtons();await refresh();}catch(error){message(error.message,true);}finally{$('cp-logout').disabled=false;}});
  $('cp-settings').addEventListener('click',showPreferences);
  $('cp-refresh').addEventListener('click',()=>perform(async()=>{if(!requireLogin())return;$('cp-refresh').disabled=true;try{const r=await service().request('refresh',{sourceId:$('cp-source').value||undefined});message(r.message);await refresh();}finally{$('cp-refresh').disabled=false;}}));
  function setViewButtons(){for(const b of root.querySelectorAll('[data-cp-view]')){b.classList.toggle('selected',b.dataset.cpView===view);b.setAttribute('aria-pressed',String(b.dataset.cpView===view));}}
  for(const b of root.querySelectorAll('[data-cp-view]'))b.addEventListener('click',()=>{if(b.dataset.cpView!=='all'&&!requireLogin())return;view=b.dataset.cpView;page=1;setViewButtons();void loadList().catch(e=>message(e.message,true));});
  for(const id of ['cp-source','cp-category','cp-range'])$(id).addEventListener('change',()=>{page=1;void loadList().catch(e=>message(e.message,true));});
  $('cp-query').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;loadList().catch(e=>message(e.message,true));},250);});
  $('cp-prev').addEventListener('click',()=>{page--;void perform(loadList);});$('cp-next').addEventListener('click',()=>{page++;void perform(loadList);});
  for(const name of ['detail','preferences']){const d=$('cp-'+name);$('cp-'+name+'-close').addEventListener('click',()=>closeDialog(d));d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(d);});}
  window.addEventListener('course-session',e=>{const key=e.detail.url+'|'+e.detail.userId;if(key===identity)return;identity=key;listGeneration++;overview=null;$('cp-list').replaceChildren(el('p','正在读取通知','muted'));$('cp-user').textContent='';$('cp-auth').hidden=!!e.detail.userId;$('cp-identity').hidden=!e.detail.userId;$('cp-summary').textContent='正在读取来源状态';if($('cp-detail').open)closeDialog($('cp-detail'));if($('cp-preferences').open)closeDialog($('cp-preferences'));if(!e.detail.userId){view='all';page=1;setViewButtons();}if(visible)void refresh();});
  window.addEventListener('course-view',e=>{visible=e.detail==='campus';if(visible)void refresh();});
  window.addEventListener('course-open-notice', event => { if (visible) void openDetail(event.detail); });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible)void refresh();});
  setInterval(()=>{if(visible&&!document.hidden&&!busy&&!$('cp-preferences').open)void refresh();},30000);
  if(visible)void refresh();
})();
