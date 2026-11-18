'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

function cookieDetails(cookie, now = Date.now() / 1000) {
  const host = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  if (!(host === 'dufe.edu.cn' || host.endsWith('.dufe.edu.cn')) || /[\s/:@]/.test(host)) return null;
  if (!cookie.name || typeof cookie.value !== 'string' || !String(cookie.path || '/').startsWith('/')) return null;
  if (cookie.expirationDate != null && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= now)) return null;
  const details = { url: 'https://' + host + (cookie.path || '/'), name: cookie.name, value: cookie.value,
    path: cookie.path || '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly, sameSite: cookie.sameSite || 'unspecified' };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.expirationDate != null) details.expirationDate = cookie.expirationDate;
  return details;
}
const key = cookie => [cookie.domain,cookie.path,cookie.name].join('\n');

class LoginMemory {
  constructor(session, directory) {
    this.session = session;
    this.file = path.join(directory,'school-login.bin');
    this.queue = Promise.resolve();
    this.paused = false;
    this.timer = null;
    this.onChanged = (_event,cookie) => { if(cookieDetails({...cookie,expirationDate:undefined}))this.schedule(); };
  }
  async start() {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const bytes = await fs.readFile(this.file);
        const saved = JSON.parse((await safeStorage.decryptStringAsync(bytes)).result);
        if(saved.version===1 && Array.isArray(saved.cookies)) {
          const existing = new Set((await this.session.cookies.get({})).map(key));
          for(const cookie of saved.cookies.slice(0,200)) {
            const details=cookieDetails(cookie);
            if(details && !existing.has(key(cookie)))await this.session.cookies.set(details);
          }
        }
      } catch { /* A missing, corrupt, or another OS user's vault requires a normal school login. */ }
    }
    this.session.cookies.on('changed',this.onChanged);
    await this.save();
  }
  schedule() {
    if(this.paused)return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>void this.save(),200);
  }
  save() {
    clearTimeout(this.timer);
    if(this.paused)return this.queue;
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      if(this.paused)return;
      const cookies=(await this.session.cookies.get({})).filter(c=>cookieDetails(c));
      if(this.paused)return;
      this.session.flushStorageData();
      await this.session.cookies.flushStore();
      if(!safeStorage.isEncryptionAvailable())return;
      if(!cookies.length){await fs.rm(this.file,{force:true});return;}
      const encrypted=await safeStorage.encryptStringAsync(JSON.stringify({version:1,cookies}));
      const temp=this.file+'.tmp';
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await fs.writeFile(temp,encrypted,{mode:0o600});
      await fs.rename(temp,this.file);
    }).catch(()=>{ /* Browser persistence still works if OS-protected storage is unavailable. */ });
    return this.queue;
  }
  async forget() {
    this.paused=true;
    clearTimeout(this.timer);
    await this.queue;
    await fs.rm(this.file,{force:true});
    await fs.rm(this.file+'.tmp',{force:true});
  }
  resume() { this.paused=false; }
  async close() { this.session.cookies.removeListener('changed',this.onChanged);await this.save(); }
}
module.exports={LoginMemory,cookieDetails};
