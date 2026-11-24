const { BrowserWindow } = require('electron');
const { ORIGIN, MonitorError } = require('./core.cjs');

function isSchoolUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'dufe.edu.cn' || u.hostname.endsWith('.dufe.edu.cn')) && !u.username && !u.password; } catch { return false; }
}
const { loginFormScript } = require('./shared/school-login-form.cjs');
const { ALLOWED_REQUESTS, requestScript } = require('./shared/school-protocol.cjs');
const { loadTimetable, loadTermTimetable, loadWeekTimetable } = require('./shared/timetable.cjs');
function bounded(promise, milliseconds = 20000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new MonitorError('network', '学校响应超时，请检查网络后重试')), milliseconds); })]).finally(() => clearTimeout(timer));
}
class SchoolApi {
  constructor({ onLogin, onSession, icon }) { this.onSession = onSession; this.window = null; this.onLogin = onLogin; this.icon = icon; this.opening = null; this.lastRecovery = 0; this.recovering = null; this.generation = 0; }
  async recoverLogin(force = false) {
    if(this.recovering)return this.recovering;
    const w=this.window;
    if(!w || w.isDestroyed() || w.isVisible() || (!force && Date.now()-this.lastRecovery<60000))return false;
    this.lastRecovery=Date.now();
    const generation=this.generation;
    const recovery=bounded(w.loadURL(ORIGIN+'/')).then(()=>generation===this.generation).catch(()=>false).finally(()=>{if(this.recovering===recovery)this.recovering=null;});
    this.recovering=recovery;
    return this.recovering;
  }
  async open(url = ORIGIN, show = true) {
    if(this.clearing)throw new MonitorError('auth','正在退出学校，请稍后重试');
    if (!isSchoolUrl(url)) throw new MonitorError('input', '只能打开学校的 HTTPS 页面');
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({ title: '学校登录 · 东财课历', width: 1120, height: 820, minWidth: 700, minHeight: 540, show: false, icon: this.icon, autoHideMenuBar: true, webPreferences: { partition: 'persist:dufe-school', nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      const w = this.window;
      w.webContents.setWindowOpenHandler(({ url }) => { if (isSchoolUrl(url)) w.loadURL(url).catch(() => {}); return { action: 'deny' }; });
      for (const name of ['will-navigate','will-redirect']) w.webContents.on(name, (event, target) => { if (!isSchoolUrl(target)) event.preventDefault(); });
      w.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      w.webContents.session.setPermissionCheckHandler(() => false);
      w.on('close', event => { if (!this.quitting) { event.preventDefault(); w.hide(); } });
      w.webContents.on('did-stop-loading', () => { if (this.loginRequested && w.webContents.getURL().startsWith(ORIGIN + '/')) this.onLogin?.(); });
      this.opening = w.loadURL(url).catch(() => { throw new MonitorError('network', '学校页面暂时无法打开，请检查网络'); }).finally(() => { this.opening = null; });
    } else if (show && this.window.webContents.getURL() !== url && !this.window.webContents.getURL().startsWith('https://sso.dufe.edu.cn/')) {
      this.opening = this.window.loadURL(url).catch(() => { throw new MonitorError('network', '学校页面暂时无法打开'); }).finally(() => { this.opening = null; });
    }
    if (show) { this.loginRequested = true; this.window.show(); this.window.focus(); }
    if (this.opening) await bounded(this.opening);
  }
  async request(path, method, params) {
    if (!Object.hasOwn(ALLOWED_REQUESTS, path) || ALLOWED_REQUESTS[path] !== method) throw new MonitorError('input', '不支持的读取操作');
    const generation=this.generation;
    let result=await this.read(path,method,params);
    if(['auth', 'session-pending'].includes(result?.error) && generation===this.generation && await this.recoverLogin() && generation===this.generation)result=await this.read(path,method,params);
    if(generation!==this.generation)throw new MonitorError('auth','学校账号已退出，请重新登录');
    const errors = { auth: '登录已过期或尚未登录，请点击“登录学校”', network: '无法连接学校服务器，将自动重试', 'rate-limit': '学校暂时限制了查询频率，已降低检查频率', protocol: '学校返回的数据无法识别，请打开学校页面核对' };
    if (result?.error === 'session-pending') result = { error: 'network' };
    if (result?.error) {
      if (result.error === 'auth') this.onSession?.(null);
      throw new MonitorError(result.error, errors[result.error] || errors.protocol);
    }
    if (!result?.scope) throw new MonitorError('protocol', errors.protocol);
    if (result.identity) this.onSession?.(result.identity);
    return result;
  }
  async read(path,method,params) {
    await this.open(ORIGIN, false);
    const contents = this.window.webContents;
    if (contents.isLoadingMainFrame()) {
      let onStopped;
      try { await bounded(new Promise(resolve => { onStopped = resolve; contents.once('did-stop-loading', onStopped); })); }
      finally { contents.removeListener('did-stop-loading', onStopped); }
    }
    let result;
    try {
      const page = new URL(contents.getURL());
      if (page.origin !== ORIGIN) {
        const loginPage = page.origin === 'https://sso.dufe.edu.cn' &&
          page.pathname === '/auth/oauth/authorize' &&
          await bounded(contents.executeJavaScript(loginFormScript()));
        return { error: loginPage ? 'auth' : 'network' };
      }
      result = await bounded(contents.executeJavaScript(requestScript(path, method, params)));
    }
    catch { throw new MonitorError('network', '学校页面正在切换或连接中断，请稍后重试'); }
    return result;
  }
  async fillLogin(credentials, stillAuthorized) {
    await this.open(ORIGIN + '/');
    for (let attempt = 0; attempt < 24; attempt++) {
      const window = this.window;
      if (!stillAuthorized() || !window || window.isDestroyed() || !window.isVisible()) break;
      const contents = window.webContents;
      const url = contents.getURL();
      if (!contents.isLoadingMainFrame() && url.startsWith('https://sso.dufe.edu.cn/auth/oauth/authorize')) {
        if (await bounded(contents.executeJavaScript(loginFormScript(credentials)), 2000).catch(() => false)) return true;
      }
      if (!contents.isLoadingMainFrame() && url.startsWith(ORIGIN + '/') && attempt >= 4) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }
  exercises(lesson) {
    return this.request('/student/exercise/getExerciseList', 'POST', {
      courseId: lesson.courseId, courseNo: lesson.courseNo, courseSeq: lesson.courseSeq, weekTimeId: lesson.id
    });
  }
  schedule(config) { return loadTimetable(this.request.bind(this), config); }
  termSchedule(validateScope) { return loadTermTimetable(this.request.bind(this), validateScope); }
  weekSchedule(scope, week) { return loadWeekTimetable(this.request.bind(this), scope, week); }
  homeworkList() { return this.request('/student/HomeworkList', 'GET', { operation: '3' }); }
  homeworkDetail(item) {
    const { courseNo, courseSeq, weekTime, week, section, continunity, weekTimeId } = item;
    return this.request('/student/getWeekTimePaper', 'POST', { courseNo, courseSeq, weekTime, week, section, continunity, weekTimeId });
  }
  list(lesson) { return this.request('/student/signIn/getStuSignInList','POST',{ weekTimeId: lesson.id }); }
  detail(item) { return this.request(item.type === 3 ? '/student/signIn/getOnlineSignInInfo' : '/student/signIn/getSignInInfo','POST',{ signInId: item.id }); }
  async logout() {
    this.clearing = true;
    this.close();
    this.window = null;
    this.quitting = false;
    const { session } = require('electron');
    try {
      await session.fromPartition('persist:dufe-school').clearStorageData();
      await session.fromPartition('persist:dufe-school').cookies.flushStore();
      this.onSession?.(null);
    } finally { this.clearing = false; }
  }
  close() { this.generation++; this.lastRecovery=0; this.recovering=null; this.quitting = true; this.window?.destroy(); }
}
module.exports = { SchoolApi, requestScript, isSchoolUrl };
