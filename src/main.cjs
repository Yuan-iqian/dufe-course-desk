const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification, powerMonitor, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Monitor, parseCourseUrl, schoolSigninUrl, signinActivityUrl, timetableLessonUrl, ORIGIN, MonitorError } = require('./core.cjs');
const { FileStore } = require('./store.cjs');
const { SchoolApi } = require('./school.cjs');
const { CampusCardWindow } = require('./campus-card.cjs');
const { SchoolCredentials } = require('./school-credentials.cjs');
const { LoginMemory } = require('./login-memory.cjs');
const { DemoApi } = require('./demo.cjs');
const { HomeworkMonitor } = require('./homework.cjs');
const { CampusClient } = require('./shared/campus-client.cjs');
const { CampusMonitor } = require('./campus-monitor.cjs');
const hostedService = require('./hosted-service.json');

const demo = process.argv.includes('--demo');
const test = process.argv.includes('--test-mode');
const profileArg = process.argv.find(x => x.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice(10)));
else app.setPath('userData', path.join(app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..'), demo ? '演示数据' : '用户数据'));
app.setPath('sessionData', app.getPath('userData'));
app.setAppUserModelId('cn.dufe.signin-reminder');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!test && !app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow, tray, monitor, homework, campus, campusMonitor, campusCard, api, quitting = false;
  let schoolIdentity = null;
  let loggingOut = false;
  let loginMemory, credentials, credentialOperation = false, readyToQuit = false;
  const notifications = new Set();
  const uiPath = path.join(__dirname, 'ui', 'index.html');
  const uiUrl = pathToFileURL(uiPath).href;
  const iconPath = path.join(__dirname, 'assets', 'app.png');
  const showMain = () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.show(); mainWindow?.focus(); };
  const snapshot = () => {
    const { scheduleSync, ...state } = monitor.snapshot();
    const work = homework.snapshot();
    return { ...state, homework: work, sync: { schedule: scheduleSync, homework: work.sync }, campusTasks: campus?.pendingDeadlines() || [], schoolIdentity, demo, notificationSupported: Notification.isSupported() };
  };
  const updateSession = identity => {
    const previous = schoolIdentity;
    schoolIdentity = identity;
    if (previous && previous.id !== identity?.id) { campusCard?.close(); monitor?.invalidateLogin(); homework?.invalidateLogin(); }
    campus?.setSession(identity);
    if (mainWindow && !mainWindow.isDestroyed()) push();
  };
  const startAll = () => Promise.all([monitor.start(), homework.start()]);
  const pauseAll = () => { monitor.stop(); homework.stop(); };
  const refreshAll = () => Promise.all([monitor.check({ refresh: true }), homework.check()]);
  const push = () => { if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('reminder:state', snapshot()); updateTray(); };
  function updateTray() {
    if (!tray || !monitor) return;
    const running = monitor.state.running || homework?.state.running;
    tray.setToolTip(`东财课历 · ${running ? '监控中' : '已暂停'}`);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开东财课历', click: showMain }, { label: running ? '暂停监控' : '开始监控', click: () => running ? pauseAll() : startAll() }, { type: 'separator' }, { label: '退出并停止监控', click: () => app.quit() }]));
  }
  function notify(record, config, isTest = false) {
    // An in-app alert is always available; OS display is an additional channel, not a delivery receipt.
    if (config.sound) mainWindow.webContents.send('reminder:sound');
    mainWindow.flashFrame(true);
    if (Notification.isSupported() && !test) {
      const activityTitle = record.kind === 'exercise' ? `${record.courseTitle} · 课堂练习` : `${record.courseTitle} 开始签到`;
      const n = new Notification({ title: isTest ? '东财课历 · 测试' : record.kind === 'login' ? '签到监控已暂停' : record.kind === 'homework' ? `${record.courseTitle} · 作业提醒` : activityTitle, body: isTest ? '收到这条通知，说明系统提醒已开启' : record.title, icon: iconPath, silent: !config.sound, timeoutType: 'never' });
      notifications.add(n);
      n.on('click', () => { if (!isTest && !demo && record.url) api.open(record.url).catch(() => showMain()); else showMain(); });
      n.on('close', () => notifications.delete(n));
      n.on('failed', () => { notifications.delete(n); showMain(); mainWindow.webContents.send('reminder:state', { ...snapshot(), notificationWarning: '系统通知未能显示，请检查 Windows 通知设置' }); });
      n.show();
    }
    if (!isTest) showMain();
  }
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const { session } = require('electron');
    loginMemory = new LoginMemory(session.fromPartition('persist:dufe-school'), app.getPath('userData'));
    if(!demo)await loginMemory.start();
    credentials = new SchoolCredentials(app.getPath('userData'));
    mainWindow = new BrowserWindow({ title: '东财课历', width: 1180, height: 900, minWidth: 390, minHeight: 600, backgroundColor: '#ffffff', icon: iconPath, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.session.setPermissionRequestHandler((_wc,_permission, callback) => callback(false));
    mainWindow.on('close', event => { if (!quitting && tray && !test) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.on('focus', () => mainWindow.flashFrame(false));
    api = demo ? new DemoApi() : new SchoolApi({ icon: iconPath, onSession: updateSession, onLogin: () => { if (monitor && homework) refreshAll(); } });
    campusCard = new CampusCardWindow({ icon: iconPath, onClose: () => {
      if (!quitting) showMain();
      if(!quitting&&!loggingOut&&!demo)void api.recoverLogin(true).then(()=>refreshAll()).catch(()=>{});
    } });
    let store;
    try { store = new FileStore(app.getPath('userData')); store.read(); }
    catch (error) { dialog.showErrorBox('提醒记录无法读取', error.message); app.quit(); return; }
    monitor = new Monitor({ api, store, notify });
    try { homework = new HomeworkMonitor({ api, store:new FileStore(app.getPath('userData'),'homework-state.json'), notify, config:() => monitor.config }); }
    catch (error) { dialog.showErrorBox('作业记录无法读取', error.message); app.quit(); return; }
    monitor.on('change', push);
    homework.on('change', push);
    campus = new CampusClient({
      store: new FileStore(app.getPath('userData'), 'campus-local-state.json'),
      url: hostedService.url,
      fetchPublic: async route => {
        const response = await fetch(hostedService.url + '/api/campus/' + route, {signal: AbortSignal.timeout(20000), redirect: 'error'});
        if (!response.ok) throw new Error('校园公告暂时无法同步，请稍后重试');
        const value = await response.json();
        if (!value.ok) throw new Error(value.message || '校园公告读取失败');
        return value.data;
      }
    });
    campusMonitor = new CampusMonitor({source:campus,directory:app.getPath('userData'),notify:items=>{
      if(!Notification.isSupported()||test||demo)return;
      const n=new Notification({title:items.length>1?`校园通知 · ${items.length} 条更新`:'校园通知 · 新公告',body:items.slice(0,3).map(i=>i.title).join('\n'),icon:iconPath,silent:!monitor.config.sound});
      notifications.add(n);n.on('click',()=>{showMain();mainWindow.webContents.send('reminder:open-campus');});n.on('close',()=>notifications.delete(n));n.on('failed',()=>notifications.delete(n));n.show();
    }});
    campus.on('change', state => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('reminder:campus-session', state); });
    campus.on('tasks-changed', push);
    monitor.on('login-required', () => { updateSession(null); homework.invalidateLogin(); if (!test) notify({ kind: 'login', title: '登录已失效，请重新登录学校', courseTitle: '监控已暂停' }, { sound: false }); });
    if (!test) {
      try { tray = new Tray(nativeImage.createFromPath(iconPath)); tray.on('double-click', showMain); updateTray(); } catch { tray = null; }
    }
    powerMonitor.on('suspend', () => { campusCard.suspend(); monitor.suspend(); homework.suspend(); campusMonitor.suspend(); });
    powerMonitor.on('resume', () => { campusCard.resume(); monitor.resume(); homework.resume(); campusMonitor.resume(); });
    ipcMain.handle('reminder:action', async (event, action, payload) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== uiUrl) return { ok: false, message: '无效的应用请求' };
      try {
        if(loggingOut && !['snapshot','campus-session'].includes(action))throw new MonitorError('input','正在退出学校，请稍后重试');
        if(action==='campus') {
          try{return {ok:true,data:await campus.campusRequest(payload)};}catch(error){return {ok:false,message:error.message||'校园通知读取失败'};}
        }
        if(action==='open-campus-source') {
          const target=new URL(payload);
          if(!['https:','http:'].includes(target.protocol)||target.username||target.password||!(target.hostname==='dufe.edu.cn'||target.hostname.endsWith('.dufe.edu.cn')||target.hostname==='mp.weixin.qq.com'))throw new Error('无效的学校来源地址');
          await shell.openExternal(target.href);return {ok:true};
        }
        if (action === 'credentials-status') return { ok: true, saved: !demo && await credentials.saved() };
        if (['credentials-save', 'credentials-clear', 'login-fill'].includes(action)) {
          if (demo) throw new MonitorError('input', '请在正式软件中管理学校账号');
          if (credentialOperation) throw new MonitorError('input', '正在处理学校账号，请稍后重试');
          credentialOperation = true;
          try {
            if (action === 'credentials-save') await credentials.save(payload?.account, payload?.password);
            if (action === 'credentials-clear') await credentials.clear();
            if (action === 'login-fill') {
              const generation = api.generation;
              const filled = await api.fillLogin(await credentials.read(), () => !loggingOut && api.generation === generation);
              if (!filled) throw new MonitorError('input', '未找到学校账号登录表单，请在学校窗口核对页面');
            }
            return { ok: true, saved: await credentials.saved() };
          } finally { credentialOperation = false; }
        }
        if (action === 'campus-session') return { ok:true, data:campus.snapshot() };
        if (action === 'term-timetable') return { ok:true, data:await monitor.termTimetable(payload === true) };
        if (action === 'week-timetable') return { ok:true, data:await monitor.weekTimetable(payload?.week, payload?.refresh === true) };
        if (action === 'logout-school') {
          loggingOut = true;
          try {
          await loginMemory.forget();
          campusCard.close();
          monitor.invalidateLogin();
          homework.invalidateLogin();
          if (!demo) await api.logout();
          updateSession(null);
          return { ok:true, data:snapshot() };
          } finally { loginMemory.resume(); loggingOut = false; }
        }
        if (action === 'snapshot') return { ok: true, data: snapshot() };
        if (action === 'open-campus-card') {
          if (loggingOut) throw new MonitorError('input', '正在退出学校，请稍后重试');
          if (demo) throw new MonitorError('input','模拟演示没有真实校园码，请打开正式软件使用');
          await campusCard.open(); return { ok: true };
        }
        if (action === 'login') { if (demo) { api.scenario = 'empty'; updateSession({id:'demo-school-account',nickname:'演示学校账号'}); await refreshAll(); } else { await api.open(ORIGIN + '/'); await refreshAll(); } }
        else if (action === 'start') await startAll();
        else if (action === 'pause') pauseAll();
        else if (action === 'refresh') await refreshAll();
        else if (action === 'refresh-timetable') await monitor.check({ refresh: true });
        else if (action === 'homework-refresh') await homework.check();
        else if (action === 'save') { monitor.configure(payload); homework.stop(); }
        else if (action === 'open-homework') {
          if (demo) throw new MonitorError('input','模拟作业无法在学校页面打开');
          const item = payload ? homework.state.items.find(row => row.id === payload) : null;
          if (payload && !item) throw new MonitorError('input','请同步后重新选择作业');
          await api.open(item?.url || `${ORIGIN}/homework/`);
        }
        else if (action === 'import') { monitor.configure({ ...monitor.config, ...parseCourseUrl(payload), mode: 'manual' }); await monitor.check({ refresh: true }); }
        else if (action === 'test-notification') notify({ title: '测试提醒', courseTitle: '东财课历' }, monitor.config, true);
        else if (action === 'open-lesson') {
          if (demo) throw new MonitorError('input', '模拟课次无法在学校页面打开');
          await api.open(timetableLessonUrl(monitor, payload));
        }
        else if (action === 'open-signin-activity') {
          if (demo) throw new MonitorError('input', '模拟签到无法在学校页面打开');
          await api.open(signinActivityUrl(monitor, payload));
        }
        else if (action === 'open-school') {
          if (demo) throw new MonitorError('input', '当前是模拟演示，学校页面不会打开');
          await api.open(schoolSigninUrl(monitor, payload));
        }
        else if (action === 'notifications-settings') await shell.openExternal('ms-settings:notifications');
        else if (action === 'demo-scenario' && demo) {
          if (!['empty','active','ended','offline','expired','exercise','new'].includes(payload)) throw new MonitorError('input', '无效的演示场景');
          if (payload === 'new') { api.eventId++; api.scenario = 'active'; } else api.scenario = payload;
          await monitor.check({ refresh: true });
        }
        else if (action === 'quit') { app.quit(); return { ok: true }; }
        else throw new MonitorError('input', '不支持的操作');
        push(); return { ok: true, data: snapshot() };
      } catch (error) { return { ok: false, message: error instanceof MonitorError ? error.message : '操作失败，请稍后重试' }; }
    });
    mainWindow.loadFile(uiPath);
    mainWindow.once('ready-to-show', showMain);
    if (!demo && !test) void refreshAll();
  });
  app.on('before-quit', event => {
    if(readyToQuit)return;
    event.preventDefault();
    if(quitting)return;
    quitting = true; campusCard?.close(); monitor?.stop(); homework?.stop(); campusMonitor?.close(); api?.close?.(); tray?.destroy(); tray = null;
    Promise.resolve(demo?null:loginMemory?.close()).finally(()=>{readyToQuit=true;app.quit();});
  });
  app.on('window-all-closed', () => { if (test || !tray) app.quit(); });
}
