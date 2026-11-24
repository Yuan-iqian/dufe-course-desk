'use strict';
const $ = id => document.getElementById(id);
let state, settingsKey = '', historyKey = '', activitiesKey = '', noticeTimer, busy = false;
const clock = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value) : '尚未检查';
const day = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' }).format(value);
const description = lesson => `${lesson.date.slice(5).replace('-', '月')}日 ${lesson.beginTime}–${lesson.endTime}`;
function text(tag, content, cls) { const el = document.createElement(tag); el.textContent = content; if (cls) el.className = cls; return el; }
function notice(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
async function act(action, payload) {
  const result = await window.reminder.invoke(action, payload);
  if (!result.ok) throw new Error(result.message);
  if (result.data) render(result.data);
  return result.data;
}
async function perform(action, payload) {
  if (busy && action !== 'pause') return;
  if (action === 'start') { clearTimeout(noticeTimer); $('notice').hidden = true; }
  busy = true; if (state) render(state);
  try { return await act(action,payload); } catch (error) { notice(error.message); }
  finally { busy = false; if (state) render(state); }
}
function render(s) {
  state = s;
  renderHomework();
  $('demo-badge').hidden = $('demo-tools').hidden = !s.demo;
  const lesson = s.lessons[0];
  $('course-title').textContent = lesson?.title || '全部课程活动';
  $('today-label').textContent = day(Date.now());
  $('error-banner').hidden = !s.error && !s.notificationWarning;
  $('error-text').textContent = s.error || s.notificationWarning || '';
  $('exercise-error').textContent = s.exerciseError || '';
  $('exercise-error').hidden = !s.exerciseError;
  $('manage-login').hidden = s.demo;
  $('today-login-saved').hidden = s.demo;
  $('last-checked').textContent = clock(s.lastChecked);
  $('status-pill').classList.toggle('is-running', s.running);
  const labels = { idle:'尚未开始监控', paused:'监控已暂停', ready:'已连接学校', waiting:'等待上课', watching:'正在监控', error:'检查遇到问题', 'login-required':'需要重新登录', sleeping:'电脑休眠中' };
  $('status-label').textContent = s.checking ? '正在检查' : labels[s.phase] || '监控已暂停';
  const active = s.activities.filter(x=>x.state==='active');
  const overlap = s.lessons.length > 1 ? ` · 同时检查另外 ${s.lessons.length - 1} 节` : '';
  $('lesson-label').textContent = lesson ? description(lesson) + overlap : s.upcoming ? `下一节 ${s.upcoming.title} · ${description(s.upcoming)}` : s.connected ? '已同步课表中没有后续课次' : '登录后同步课表';
  let title, hint, icon = 'bell';
  if (s.phase==='login-required' || !s.connected) { title='先连接你的课堂';hint='在学校页面完成登录，再同步课表'; }
  else if (s.phase==='error') { title='暂时无法确认签到状态';hint=s.running?'连接恢复后会继续检查':'处理上方问题后重新开始';icon='circle-alert'; }
  else if (active.length) { title=`${active.length} 项课堂活动进行中`;hint='到学校页面参加签到或练习';icon='bell-ring'; }
  else if (!s.running) { title='准备好后，开始监控';hint='新签到出现时显示桌面提醒'; }
  else if (!s.lessons.length) { title='课前自动开始检查';hint=s.upcoming?'到监控时间后会自动切换到下一课次':'当前课表内没有待监控课次';icon='calendar-days'; }
  else { title='正在留意新签到';hint='发现进行中的签到后立即提醒'; }
  $('watch-title').textContent=title;$('watch-description').textContent=hint;$('watch-icon').src=`../assets/${icon}.svg`;
  const anyRunning = s.running || s.homework?.running;
  $('toggle-label').textContent=anyRunning?'暂停监控':'开始监控';$('toggle-icon').src=`../assets/${anyRunning?'pause':'play'}.svg`;
  $('toggle').disabled=!s.running&&(busy||s.checking);$('refresh').disabled=busy||s.checking;
  $('refresh-label').textContent=s.checking?'正在检查…':'同步课表并检查';
  for (const name of ['save','import','login']) $(name).disabled=busy||s.checking;
  $('connection-label').textContent=s.connected?'学校登录有效':'尚未连接学校';
  if(s.phase==='login-required')$('connection-label').textContent='登录已失效';
  if(s.phase==='error')$('connection-label').textContent='学校连接异常';
  document.querySelector('.connection-box').classList.toggle('connected',s.connected&&s.phase!=='error');
  $('login-label').textContent=s.connected?'学校账号':'登录学校';
  $('login').setAttribute('aria-label', $('login-label').textContent);
  const selectableLessons = s.manualLesson ? [...s.schedule, s.manualLesson] : s.schedule;
  const key=JSON.stringify([s.config,selectableLessons]);
  if(key!==settingsKey){
    settingsKey=key;$('mode').value=s.config.mode;$('interval').value=s.config.interval;$('sound').checked=s.config.sound;
    const options=selectableLessons.map(x=>{const option=text('option',`${x.title} · ${description(x)}`);option.value=x.id;return option;});
    if(!options.length){const option=text('option','请先同步课表');option.value='';options.push(option);}
    $('lesson').replaceChildren(...options);$('lesson').value=s.config.lessonId||s.lessons[0]?.id||s.upcoming?.id||s.schedule[0]?.id||'';updateMode();
  }
  const newActivities=JSON.stringify(s.activities);
  if(newActivities!==activitiesKey){
    activitiesKey=newActivities;
    const statusLabels={active:'进行中',scheduled:'未开始',completed:'已参与',ended:'已结束'};
    const rows=s.activities.map(item=>{const row=text('div','', 'activity-row');const copy=text('div','');copy.append(text('strong',item.title),text('small',item.courseTitle + ' · ' + (item.kind === 'exercise' ? '练习' : '签到')));row.append(copy,text('span',statusLabels[item.state],`activity-state ${item.state}`));return row;});
    if(!rows.length)rows.push(text('p',s.connected?'当前没有进行中的签到或练习':'登录并检查后显示课堂活动','empty-inline'));
    $('activities').replaceChildren(...rows);
  } else if(!s.activities.length){$('activities').firstElementChild.textContent=s.connected?(s.lessons.length?'当前没有进行中的签到或练习':'进入监控时段后检查课堂活动'):'登录并检查后显示课堂活动';}
  const newHistory=JSON.stringify(s.history);
  if(newHistory!==historyKey){
    historyKey=newHistory;$('history-count').textContent=`${s.history.length} 条`;
    if(s.history.length){const rows=s.history.map(item=>{const row=text('div','', 'history-row');const copy=text('div','');copy.append(text('strong',item.title),text('small',`${day(item.detectedAt)} ${clock(item.detectedAt)} · ${item.delivery==='emitted'?'已发出提醒':'等待发送'}`));const button=text('button',item.kind === 'exercise' ? '打开练习' : '打开签到','text-button');button.addEventListener('click',()=>perform('open-school',item.key));row.append(copy,button);return row;});$('history').replaceChildren(...rows);}
    else{const empty=text('div','', 'history-empty');const icon=document.createElement('img');icon.src='../assets/bell-ring.svg';icon.alt='';empty.append(icon,text('p','新签到或练习的提醒会记录在这里'));$('history').replaceChildren(empty);}
  }
  tick();
}
function tick() {
  if (!state) return;
  $('next-check').textContent = state.nextCheck && state.running
    ? `${Math.max(0, Math.ceil((state.nextCheck - Date.now()) / 1000))} 秒后${state.phase === 'waiting' ? '核对课次' : '检查'}`
    : state.checking ? '正在获取学校数据' : '';
  todayHome.render(state, busy);
  timetableView.render(state);
}
function updateMode(){$('lesson-field').hidden=$('mode').value!=='manual';$('mode-hint').textContent=$('mode').value==='manual'?'持续检查选中的课次，直到你暂停':'按课表依次检查每节课，覆盖课前 10 分钟到课后 15 分钟';}
$('mode').addEventListener('change',updateMode);
$('toggle').addEventListener('click',()=>perform(state.running||state.homework?.running?'pause':'start'));
$('login').addEventListener('click',()=>perform('login'));
const accountDialog = $('school-account-dialog');
const accountForm = $('school-account-form');
let credentialsSaved = false;
async function manageCredentials(action, payload) {
  const controls = ['school-account-fill', 'school-account-clear', 'school-account-save'].map($);
  controls.forEach(button => { button.disabled = true; });
  try {
    const result = await window.reminder.invoke(action, payload);
    if (!result.ok) throw new Error(result.message);
    credentialsSaved = result.saved === true;
    if (action === 'login-fill') accountDialog.close();
    $('school-account-status').textContent = credentialsSaved ? '已保存一个学校账号' : '本机尚未保存账号';
  } catch (error) {
    $('school-account-status').textContent = error.message || '本机账号操作失败，请重试';
  } finally {
    controls[0].disabled = controls[1].disabled = !credentialsSaved;
    controls[2].disabled = false;
  }
}
function openAccountDialog() {
  $('school-account-status').textContent = '正在检查本机记录';
  accountDialog.showModal();
  void manageCredentials('credentials-status');
}
$('manage-login').addEventListener('click', openAccountDialog);
$('today-login-saved').addEventListener('click', openAccountDialog);
$('school-account-close').addEventListener('click', () => accountDialog.close());
accountDialog.addEventListener('close', () => accountForm.reset());
accountForm.addEventListener('submit', event => {
  event.preventDefault();
  if ($('school-account-save').disabled) return;
  const payload = { account: $('school-account-name').value, password: $('school-account-password').value };
  accountForm.reset();
  void manageCredentials('credentials-save', payload);
});
$('school-account-fill').addEventListener('click', () => void manageCredentials('login-fill'));
$('school-account-clear').addEventListener('click', () => void manageCredentials('credentials-clear'));
// Opening a card stays available while the timetable is syncing.
$('campus-card-open').addEventListener('click', async () => {
  const button = $('campus-card-open');
  if (button.disabled) return;
  button.disabled = true;
  try { const result = await window.reminder.invoke('open-campus-card'); if (!result.ok) notice(result.message); }
  catch { notice('校园码暂时无法打开，请稍后重试'); }
  finally { button.disabled = false; }
});
$('refresh').addEventListener('click',()=>perform('refresh'));
$('open-school').addEventListener('click',()=>perform('open-school'));
$('notification-settings').addEventListener('click',()=>perform('notifications-settings'));
$('test-notification').addEventListener('click',async()=>{await perform('test-notification');notice('已尝试发出测试提醒；没有看到弹窗时，请检查 Windows 通知设置');});
$('quit').addEventListener('click',()=>perform('quit'));
const supportDialog = $('support-dialog');
$('support-open').addEventListener('click', () => supportDialog.showModal());
$('support-close').addEventListener('click', () => supportDialog.close());
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('settings-error').hidden = true;
  const selected = $('lesson').value;
  const lesson = state.schedule.find(item => item.id === selected)
    || (state.manualLesson?.id === selected ? state.manualLesson : null);
  try {
    await act('save', {
      mode: $('mode').value, interval: Number($('interval').value), sound: $('sound').checked,
      courseNo: lesson?.courseNo, courseSeq: lesson?.courseSeq, lessonId: lesson?.id
    });
    notice('设置已保存，点击“开始监控”应用设置');
  } catch (error) {
    $('settings-error').textContent = error.message;
    $('settings-error').hidden = false;
  }
});
$('import-form').addEventListener('submit',async event=>{event.preventDefault();$('import-error').hidden=true;try{const result=await act('import',$('course-url').value.trim());if(result.error)throw new Error(result.error);$('course-details').open=false;notice('课次已指定，点击“开始监控”');}catch(error){$('import-error').textContent=error.message;$('import-error').hidden=false;}});
document.querySelectorAll('[data-scenario]').forEach(button=>button.addEventListener('click',()=>perform('demo-scenario',button.dataset.scenario)));

let homeworkKey = '', homeworkCoursesKey = '';
const dateTime = value => value == null ? '未提供截止时间' : new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value);
function currentHomeworkState(item) {
  if (item.status === '2') return 'graded';
  if (item.status === '3') return 'submitted';
  if (item.status === '4' || item.deadline !== null && item.deadline <= Date.now()) return 'overdue';
  return item.deadline !== null && item.deadline - Date.now() <= 86400000 ? 'due' : 'pending';
}
function renderHomework() {
  const hw = state?.homework;
  if (!hw) return;
  const items = hw.items.map(item => ({...item,state:currentHomeworkState(item)}));
  const counts = status => items.filter(item => status.includes(item.state)).length;
  $('hw-pending').textContent = counts(['pending','due']);
  $('hw-due').textContent = counts(['due']);
  $('hw-overdue').textContent = counts(['overdue']);
  $('hw-submitted').textContent = counts(['submitted','graded']);
  const courseMap = new Map(items.map(item => [item.courseNo + ':' + item.courseSeq, item.courseTitle]));
  const coursesKey = JSON.stringify([...courseMap]);
  if (coursesKey !== homeworkCoursesKey) {
    homeworkCoursesKey = coursesKey;
    const selected = $('homework-course').value;
    const all = text('option','全部课程'); all.value = '';
    const options = [...courseMap].map(([value,name]) => { const option=text('option',name);option.value=value;return option; });
    $('homework-course').replaceChildren(all,...options);
    $('homework-course').value = courseMap.has(selected) ? selected : '';
  }
  $('homework-summary').textContent = hw.lastChecked ? courseMap.size + ' 门课程 · ' + items.length + ' 项已发布作业' : '登录学校后同步本学期作业';
  $('homework-toggle').textContent = state.running || hw.running ? '暂停监控' : '开始监控';
  $('homework-toggle').disabled = !(state.running || hw.running) && (busy || hw.checking);
  $('homework-refresh').disabled = busy || hw.checking;
  $('homework-error').hidden = !hw.error;
  $('homework-error').textContent = hw.error + (hw.lastChecked ? ' · 当前显示上次同步结果' : '');
  $('homework-sync').textContent = hw.checking ? '正在同步全部课程作业…' : hw.lastChecked ? '上次同步 ' + dateTime(hw.lastChecked) + (hw.running ? ' · 自动监控中' : ' · 自动监控已暂停') : '尚未同步';
  const filter = $('homework-status').value;
  const course = $('homework-course').value;
  const query = $('homework-query').value.trim().toLowerCase();
  const sort = $('homework-sort').value;
  const filtered = items.filter(item => (!course || course === item.courseNo + ':' + item.courseSeq) && (filter === 'all' || item.state === filter || filter === 'pending' && item.state === 'due') && (!query || [item.title,item.courseTitle,item.teacher].join(' ').toLowerCase().includes(query)));
  const rank = {due:0,pending:1,overdue:2,submitted:3,graded:4};
  filtered.sort((a,b) => {
    if (sort === 'recent') return b.firstSeen - a.firstSeen;
    if (sort === 'priority' && rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || a.id.localeCompare(b.id);
  });
  $('homework-count').textContent = '显示 ' + filtered.length + ' / ' + items.length + ' 项';
  const key = JSON.stringify([filtered,hw.history,hw.lastChecked]);
  if (key === homeworkKey) return;
  homeworkKey = key;
  const labels = {pending:'待提交',due:'临近截止',overdue:'已过期',submitted:'已提交 · 待批改',graded:'已批改'};
  const rows = filtered.map(item => {
    const row=text('article','', 'homework-row');
    const body=text('div','', 'homework-copy');
    body.append(text('p',item.courseTitle + (item.teacher ? ' · ' + item.teacher : ''),'homework-course-name'),text('h3',item.title));
    body.append(text('p','截止 ' + dateTime(item.deadline),'homework-deadline'));
    const meta = item.score !== null ? '成绩 ' + item.score : item.state === 'overdue' ? '学校记录为过期或已超过截止时间' : item.state === 'due' ? '请及时前往学校页面完成提交' : '';
    if (meta) body.append(text('p',meta,'muted'));
    const actions=text('div','','homework-row-actions');
    actions.append(text('span',labels[item.state],'activity-state ' + item.state));
    const button=text('button',['pending','due'].includes(item.state)?'前往作业':'查看作业','btn btn-outline-secondary');
    button.addEventListener('click',()=>perform('open-homework',item.id));
    actions.append(button);row.append(body,actions);return row;
  });
  if (!rows.length) rows.push(text('p',hw.lastChecked ? items.length ? '没有符合筛选条件的作业，请调整筛选条件' : '学校作业列表中暂时没有已发布作业' : '点击“登录学校”，使用学校账号同步作业','homework-empty'));
  $('homework-list').replaceChildren(...rows);
  const history = (hw.history || []).map(item => {const row=text('div','','history-row');const copy=text('div','');copy.append(text('strong',item.title),text('small',item.courseTitle+' · '+dateTime(item.notifiedAt)));row.append(copy);return row;});
  if (!history.length) history.push(text('p','新作业与截止提醒会记录在这里','empty-inline'));
  $('homework-history-list').replaceChildren(...history);
}
const views = ['today', 'timetable', 'homework', 'signin', 'campus'];
let currentView = 'today', viewEntrance, viewExit;
const reducedViewMotion = matchMedia('(prefers-reduced-motion: reduce)');
const viewTabs = $('tab-today').parentElement;
const viewIndicator = document.createElement('span');
viewIndicator.className = 'view-tab-indicator';
viewIndicator.setAttribute('aria-hidden', 'true');

function placeViewIndicator() {
  const tab = $('tab-' + currentView);
  viewIndicator.style.width = `${tab.offsetWidth}px`;
  viewIndicator.style.height = `${tab.offsetHeight}px`;
  viewIndicator.style.transform = `translate3d(${tab.offsetLeft}px, ${tab.offsetTop}px, 0)`;
}
placeViewIndicator();
viewTabs.prepend(viewIndicator);
viewTabs.classList.add('has-view-indicator');
const viewTabsResize = new ResizeObserver(placeViewIndicator);
viewTabsResize.observe(viewTabs);
for (const name of views) viewTabsResize.observe($('tab-' + name));

function clearViewExit() {
  if (!viewExit) return;
  const { panel, motion } = viewExit;
  viewExit = undefined;
  motion.cancel();
  panel.classList.remove('view-panel-exit');
  panel.style.removeProperty('top');
  panel.style.removeProperty('max-height');
  panel.removeAttribute('inert');
  panel.removeAttribute('aria-hidden');
}

function animateViewExit(panel, direction) {
  const style = getComputedStyle(panel);
  const start = { opacity: style.opacity, transform: style.transform };
  const visibleHeight = Math.min(panel.offsetHeight, innerHeight - panel.getBoundingClientRect().top);
  viewEntrance?.cancel();
  clearViewExit();
  if (visibleHeight <= 0) return;
  panel.style.top = `${panel.offsetTop}px`;
  panel.style.maxHeight = `${visibleHeight}px`;
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  panel.classList.add('view-panel-exit');
  const reduce = reducedViewMotion.matches;
  const end = { opacity: 0, transform: reduce ? 'none' : `translateY(${-7 * direction}px)` };
  const motion = panel.animate([start, end], { duration: reduce ? 80 : 145, easing: 'ease-out' });
  viewExit = { panel, motion };
  motion.onfinish = () => { if (viewExit?.motion === motion) clearViewExit(); };
}

reducedViewMotion.addEventListener('change', () => {
  clearViewExit();
  viewEntrance?.cancel();
});

function selectView(view) {
  const changed = view !== currentView;
  if (changed) {
    const from = $(currentView + '-panel');
    const to = $(view + '-panel');
    const direction = Math.sign(views.indexOf(view) - views.indexOf(currentView));
    window.scrollTo(0, 0);
    if (from.contains(document.activeElement)) $('tab-' + view).focus({ preventScroll: true });
    animateViewExit(from, direction);
    currentView = view;
    to.hidden = false;
    const reduce = reducedViewMotion.matches;
    const start = { opacity: reduce ? .84 : .67, transform: reduce ? 'none' : `translateY(${10 * direction}px)` };
    viewEntrance = to.animate([start, { opacity: 1, transform: 'none' }], {
      duration: reduce ? 95 : 230,
      easing: 'cubic-bezier(.22, .72, .24, 1)'
    });
    placeViewIndicator();
  }
  for (const name of views) {
    $(name+'-panel').hidden = name !== view;
    $('tab-'+name).classList.toggle('selected',name === view);
    $('tab-'+name).setAttribute('aria-pressed',String(name === view));
  }
  tick();
  window.dispatchEvent(new CustomEvent('course-view',{detail:view}));
  if (changed) window.dispatchEvent(new CustomEvent('course-view-change', { detail: view }));
}
const todayHome = TodayHome.create({ perform, selectView });
const timetableView = TimetableView.create({ perform });
for (const view of views) {
  const tab = $('tab-' + view);
  tab.setAttribute('aria-controls', view + '-panel');
  tab.addEventListener('click', () => selectView(view));
}
$('today-refresh').addEventListener('click', () => perform('refresh'));
$('today-timetable-link').addEventListener('click', () => selectView('timetable'));
$('today-signin').addEventListener('click', () => selectView('signin'));
$('today-monitor-toggle').addEventListener('click', () => {
  if (!state) return;
  const action = state.running ? 'pause' : !state.connected && state.phase !== 'error' ? 'login' : 'start';
  void perform(action);
});
window.reminder.onOpenCampus(()=>selectView('campus'));
$('homework-toggle').addEventListener('click',()=>perform(state.running||state.homework?.running?'pause':'start'));
$('homework-refresh').addEventListener('click',()=>perform('homework-refresh'));
$('homework-school').addEventListener('click',()=>perform('open-homework'));
for(const name of ['homework-course','homework-status','homework-sort']) $(name).addEventListener('change',renderHomework);
$('homework-query').addEventListener('input',renderHomework);
setInterval(renderHomework,30000);

window.reminder.onState(render);
window.reminder.onSound(()=>{const audio=$('chime');audio.currentTime=0;audio.play().catch(()=>{});});
setInterval(tick,1000);
act('snapshot').catch(error=>notice(error.message));
