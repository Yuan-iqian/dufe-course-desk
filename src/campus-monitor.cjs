'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
class CampusMonitor {
  constructor({source,sharing,directory,notify,clock=Date.now,interval=60000}) {
    this.sharing=source||sharing;this.file=path.join(directory,'campus-notification-state.json');this.notify=notify;this.clock=clock;this.interval=interval;
    this.states={};this.key='';this.timer=null;this.inflight=false;this.suspended=false;this.closed=false;
    try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved&&typeof saved==='object'&&!Array.isArray(saved))this.states=saved;}catch{}
    this.listener=()=>this.sessionChanged();this.sharing.on('change',this.listener);this.sessionChanged();
  }
  sessionChanged(){
    if(this.closed)return;
    const snapshot=this.sharing.snapshot(),user=snapshot.data?.user;
    const key=user?crypto.createHash('sha256').update(snapshot.url+'\0'+user.id).digest('hex'):'';
    if(key===this.key)return;this.key=key;clearTimeout(this.timer);
    if(key){if(!this.states[key])this.states[key]={since:this.clock(),afterId:'',seen:[],history:[]};this.schedule(20);}
  }
  schedule(delay=this.interval){clearTimeout(this.timer);if(!this.closed&&!this.suspended&&this.key)this.timer=setTimeout(()=>this.check(),delay);}
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.states));fs.renameSync(this.file+'.tmp',this.file);}
  async check(){
    if(this.closed||this.suspended||!this.key||this.inflight){this.schedule();return;}
    const key=this.key,state=this.states[key];this.inflight=true;
    try{
      // Overlap normal polls so a crawl that commits after the preceding query is not missed.
      const since=state.afterId?state.since:Math.max(0,state.since-120000);
      const params=new URLSearchParams({since:String(since),afterId:state.afterId||''});
      const response=await this.sharing.campusRequest({path:'alerts?'+params});
      if(this.closed||this.suspended||key!==this.key)return;
      const seen=new Set(state.seen||[]),fresh=[];
      for(const item of response.items||[]){const id=item.id+':'+item.revision;if(seen.has(id))continue;seen.add(id);fresh.push(item);}
      state.since=response.serverTime;state.afterId=response.afterId||'';state.seen=[...seen].slice(-1000);
      const records=fresh.map(n=>({id:n.id,revision:n.revision,title:n.title,at:this.clock(),url:n.url}));state.history=[...records,...(state.history||[])].slice(0,100);this.save();
      if(fresh.length)this.notify(fresh);
      if(response.more)this.schedule(2000);else this.schedule();
    }catch{this.schedule(Math.min(this.interval*2,300000));}
    finally{this.inflight=false;}
  }
  suspend(){this.suspended=true;clearTimeout(this.timer);}
  resume(){this.suspended=false;this.schedule(1000);}
  close(){this.closed=true;clearTimeout(this.timer);this.sharing.removeListener('change',this.listener);}
}
module.exports={CampusMonitor};
