const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {CampusClient}=require('../src/shared/campus-client.cjs');
const {requestScript}=require('../src/shared/school-protocol.cjs');
const {Monitor}=require('../src/core.cjs');

test('学校登录读取不返回凭据，跨学期身份稳定，切换期间的旧响应被丢弃',async()=>{
 const values={token:'secret-test',STUDENTNO:'20260001',batch:'2026A'};
 let change=false;
 const context={localStorage:{getItem:key=>values[key]},crypto:webcrypto,TextEncoder,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async()=>{if(change)values.STUDENTNO='20260002';return new Response(JSON.stringify({code:2000,data:[]}),{headers:{'content-type':'application/json'}});}};
 const script=requestScript('/student/HomeworkList','GET',{operation:'3'});
 const a=await vm.runInNewContext(script,context);values.batch='2026B';const b=await vm.runInNewContext(script,context);
 assert.equal(a.identity.id,b.identity.id);assert.notEqual(a.scope,b.scope);assert.ok(!JSON.stringify(a).includes('secret-test'));assert.ok(!JSON.stringify(a).includes('20260001'));
 change=true;assert.equal((await vm.runInNewContext(script,context)).error,'network');
 assert.throws(()=>requestScript('/student/signIn/submit','POST',{}));
});

test('校园记录按学校账号隔离，重新登录恢复，公告修改重新变未读，离线可看缓存',async()=>{
 let saved={},clock=1000,offline=false,revision=1;
 const id='a'.repeat(64),identityA={id:'school-A',nickname:'A'},identityB={id:'school-B',nickname:'B'};
 const item=()=>({id,title:'材料提交',sourceId:'jwc',publishedAt:'2026-11-13',updatedAt:1500,revision,summary:'正文',detectedDeadline:'2026-11-20'});
 const client=new CampusClient({store:{read:()=>saved,write:value=>saved=structuredClone(value)},url:'https://example.test',clock:()=>clock,fetchPublic:async route=>{
   if(offline)throw new Error('offline');
   if(route==='overview')return {sources:[{id:'jwc'},{id:'xsc'}],categories:{}};
   if(route.startsWith('feed'))return {items:[item()],cursor:'1500:'+id,more:false};
   if(route.startsWith('notice'))return {notice:item()};
 }});
 client.setSession(identityA);await client.request('overview');
 assert.equal((await client.request('notices?range=all')).items[0].read,false);
 await client.request('state',{id,field:'read',value:true});await client.request('state',{id,field:'completed',value:true});
 await client.request('state',{id,field:'deadline',value:'2026-11-21T18:30'});
 client.setSession(identityB);const b=(await client.request('notices?range=all')).items[0];
 assert.equal(b.completed,false);assert.equal(b.read,false);assert.equal(b.deadline,'2026-11-20');
 client.setSession(null);await assert.rejects(()=>client.request('state',{id,field:'read',value:true}),/学校/);
 client.setSession(identityA);let a=(await client.request('notices?range=all')).items[0];assert.equal(a.read,true);assert.equal(a.completed,true);assert.equal(a.deadline,'2026-11-21T18:30+08:00');
 revision=2;clock+=60001;await client.sync();a=(await client.request('notices?range=all')).items[0];assert.equal(a.read,false);
 offline=true;clock+=60001;assert.equal((await client.request('overview')).cached,true);assert.equal((await client.request('notices?range=all')).items.length,1);await assert.rejects(()=>client.request('alerts?since=0'),/offline/);
 assert.equal(saved.accounts['school-B'].notices[id],undefined);
});

test('退出学校会立刻清空课表和历史显示，进行中的响应不能恢复旧状态',async()=>{
 let finish;const answer=new Promise(resolve=>finish=resolve);
 const monitor=new Monitor({api:{schedule:()=>answer},store:{read:()=>({}),write:()=>{}},notify:()=>{}});
 monitor.state.scope='old';monitor.state.connected=true;monitor.state.schedule=[{id:'old',start:1}];monitor.records=[{scope:'old',title:'old'}];
 const pending=monitor.check({refresh:true});monitor.invalidateLogin();
 finish({scope:'old',data:[]});await pending;
 assert.equal(monitor.snapshot().connected,false);assert.deepEqual(monitor.snapshot().schedule,[]);assert.deepEqual(monitor.snapshot().history,[]);
});
