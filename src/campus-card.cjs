'use strict';
const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CAMPUS_CARD_URL, isCampusCardNavigation } = require('./shared/campus-card.cjs');

class CampusCardWindow {
  constructor({ icon, onClose } = {}) {
    this.icon = icon;
    this.onClose = onClose;
    this.window = null;
    this.view = null;
    this.state = 'loading';
    this.timer = null;
    this.shellUrl = pathToFileURL(path.join(__dirname, 'ui/campus-card-window.html')).href;
    ipcMain.handle('campus-card:action', (event, action) => {
      const wc = this.window?.webContents;
      if (!wc || event.sender !== wc || event.senderFrame !== wc.mainFrame || event.senderFrame.url !== this.shellUrl) return;
      if (action === 'refresh') this.reload();
      if (action === 'close') this.close();
      return this.state;
    });
  }
  setState(state) {
    this.state = state;
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('campus-card:state', state);
  }
  loading() {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    clearTimeout(this.timer);
    this.view?.setVisible(false);
    this.setState('loading');
    this.timer = setTimeout(() => this.fail(), 25000);
  }
  fail() {
    clearTimeout(this.timer);
    if (!this.view || this.suspended) return;
    this.view?.setVisible(false);
    this.view?.webContents.stop();
    this.setState('error');
  }
  reload() {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    this.loading();
    const view = this.view;
    view.webContents.loadURL(CAMPUS_CARD_URL, { extraHeaders: 'Cache-Control: no-cache\r\n' }).catch(error => { if (this.view === view && error.code !== 'ERR_ABORTED') this.fail(); });
  }
  async open() {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show(); this.window.focus();
      return;
    }
    const w = new BrowserWindow({title:'我的校园码 · 东财课历',width:560,height:850,minWidth:390,minHeight:600,show:false,backgroundColor:'#ffffff',icon:this.icon,autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'campus-card-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    this.window = w;
    const view = new WebContentsView({webPreferences:{partition:'persist:dufe-school',nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    this.view = view;
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    w.contentView.addChildView(view);
    const fit = () => { const [width,height] = w.getContentSize(); view.setBounds({x:0,y:100,width,height:Math.max(0,height-100)}); };
    fit(); w.on('resize',fit);
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',event=>event.preventDefault());
    view.webContents.setWindowOpenHandler(({url})=>{
      if(this.view===view && isCampusCardNavigation(url)) view.webContents.loadURL(url).catch(()=>{if(this.view===view)this.fail();});
      return {action:'deny'};
    });
    for(const name of ['will-navigate','will-redirect']) view.webContents.on(name,(event,url)=>{
      if(!isCampusCardNavigation(url)){event.preventDefault();if(this.view===view)this.fail();}
    });
    view.webContents.session.setPermissionRequestHandler((_wc,_permission,done)=>done(false));
    view.webContents.session.setPermissionCheckHandler(()=>false);
    view.webContents.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(this.view===view&&main&&!inPlace)this.loading();});
    view.webContents.on('did-finish-load',()=>{
      if(this.view!==view || this.suspended || this.state === 'error')return;
      clearTimeout(this.timer);
      this.setState('ready'); view.setVisible(true);
    });
    view.webContents.on('did-fail-load',(_event,code,_description,_url,main)=>{if(this.view===view&&main&&code!==-3)this.fail();});
    view.webContents.on('render-process-gone',()=>{if(this.view===view)this.fail();});
    w.on('closed',()=>{
      if(this.window===w)clearTimeout(this.timer);
      if(!view.webContents.isDestroyed())view.webContents.close();
      if(this.window===w){this.window=null;this.view=null;this.suspended=false;}
      this.onClose?.();
    });
    try { await w.loadURL(this.shellUrl); }
    catch (error) { if (this.window === w) this.close(); throw error; }
    if (w.isDestroyed() || this.window !== w) return;
    w.show(); w.focus();
    this.reload();
  }
  suspend() {
    if(!this.view)return;
    this.suspended = true;
    clearTimeout(this.timer);
    this.view.setVisible(false);
    this.view.webContents.stop();
    this.setState('paused');
  }
  resume() { if(this.suspended){this.suspended=false;this.reload();} }
  close() { this.window?.destroy(); }
}
module.exports = { CampusCardWindow };
