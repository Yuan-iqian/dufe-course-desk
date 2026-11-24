'use strict';

const TodayHome = (() => {
  const dayMs = 86400000;
  const zone = 'Asia/Shanghai';
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric', weekday: 'long' });
  const shortDate = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric' });
  const syncTime = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const timeLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const checkTime = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const $ = id => document.getElementById(id);
  const set = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };

  function node(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function deadlineRows(state, now, firstDay, end) {
    const homework = (state.homework?.items || [])
      .filter(item => item.status === '1' && Number.isFinite(item.deadline) && item.deadline > now && item.deadline < end)
      .map(item => ({ id: item.id, title: item.title, meta: item.courseTitle, at: item.deadline, kind: 'homework' }));
    const tasks = (state.campusTasks || []).flatMap(item => {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(item.deadline);
      const at = Date.parse(dateOnly ? item.deadline + 'T00:00:00+08:00' : item.deadline);
      if (!Number.isFinite(at) || at >= end || at < (dateOnly ? firstDay : now)) return [];
      return [{ id: item.id, title: item.title, meta: '校园通知', at, dateOnly, kind: 'task' }];
    });
    return [...homework, ...tasks].sort((a, b) =>
      dayKey.format(a.at).localeCompare(dayKey.format(b.at)) || Number(!!a.dateOnly) - Number(!!b.dateOnly) || a.at - b.at
    );
  }

  function activeSignins(state, now) {
    if (!state.connected) return [];
    return state.activities.filter(item => item.state === 'active' && (!item.endTime || item.endTime > now))
      .sort((a, b) => (a.endTime || Infinity) - (b.endTime || Infinity));
  }

  function monitorCopy(state, next, active) {
    if (state.phase === 'sleeping') return ['监控已暂停', state.mobile ? '回到应用后继续检查' : '电脑唤醒后继续检查'];
    if (state.checkingLesson) return ['正在检查', state.checkingLesson.title];
    if (state.phase === 'login-required') return ['需要登录', '重新登录学校后可继续检查'];
    if (state.sync?.schedule.status === 'syncing') return ['正在同步', '正在读取学校课表'];
    if (state.checking) return ['正在检查', '正在核对课堂活动'];
    if (state.phase === 'error') return ['检查失败', state.running ? '将自动重试，也可以立即同步' : '点击「同步课表与作业」重试'];
    if (!state.running) return [state.connected ? '监控未开启' : '尚未连接', state.connected ? '开始监控后会按所选模式检查签到与练习' : '登录学校后可同步课表并开始监控'];
    if (state.lessons.length) {
      const more = state.lessons.length > 1 ? `，另有 ${state.lessons.length - 1} 节` : '';
      return [active ? `${active} 项课堂活动进行中` : '监控中', state.lessons[0].title + more];
    }
    if (next) return ['等待上课', `${next.title}，${timeLabel.format(next.start - 10 * 60000)} 开始检查`];
    return ['等待课表', '已同步课表中没有后续课次'];
  }

  function create({ perform, selectView }) {
    let timetableKey = '', urgentKey = '', agendaKey = '';

    $('today-relogin').addEventListener('click', () => perform('login'));
    $('today-retry-schedule').addEventListener('click', () => perform('refresh-timetable'));
    $('today-retry-homework').addEventListener('click', () => perform('homework-refresh'));

    function deadlineItem({ title, meta, time, label, urgent }, onClick) {
      const line = node('li', '', 'today-deadline');
      const action = node('button', '', 'today-deadline-button');
      action.type = 'button';
      const copy = node('span', '', 'today-deadline-copy');
      copy.append(node('strong', title), node('small', meta));
      action.append(node('span', time, 'today-due-time'), copy,
        node('span', label, urgent ? 'today-kind today-kind-urgent' : 'today-kind'));
      action.addEventListener('click', onClick);
      line.append(action);
      return line;
    }

    function renderUrgent(state, signins, homework, today) {
      const key = JSON.stringify([signins, homework, today]);
      if (key === urgentKey) return;
      urgentKey = key;
      $('today-urgent').hidden = !signins.length && !homework.length;
      const signinRows = signins.map(item => deadlineItem({
        title: item.title, meta: item.courseTitle,
        time: item.endTime ? `${dayKey.format(item.endTime) === today ? '' : shortDate.format(item.endTime) + ' '}${timeLabel.format(item.endTime)} 截止` : '进行中',
        label: item.kind === 'exercise' ? '练习进行中' : '签到进行中', urgent: true
      }, () => state.demo ? selectView('signin') : perform('open-signin-activity', { lessonId: item.lessonId, id: item.id, kind: item.kind })));
      const homeworkRows = homework.map(row => deadlineItem({
        title: row.title, meta: row.meta, time: timeLabel.format(row.at), label: '作业今日截止', urgent: true
      }, () => state.demo ? selectView('homework') : perform('open-homework', row.id)));
      $('today-urgent-list').replaceChildren(...signinRows, ...homeworkRows);
    }

    function renderSync(state, busy) {
      const relogin = state.phase === 'login-required' || Object.values(state.sync || {}).some(item => item.status === 'login-required');
      $('today-sync-auth').hidden = !relogin;
      $('today-relogin').disabled = busy || state.checking;
      for (const kind of ['schedule', 'homework']) {
        const sync = state.sync?.[kind];
        const time = sync?.lastSuccessAt;
        set(`today-sync-${kind}-time`, Number.isFinite(time) ? `上次成功 ${syncTime.format(time)}` : '尚未同步');
        const status = $(`today-sync-${kind}-status`);
        const error = sync?.status === 'error';
        set(status.id, error ? (time ? '同步失败，显示上次结果' : '同步失败') : sync?.status === 'syncing' ? '正在同步…' : '');
        status.hidden = !status.textContent;
        status.classList.toggle('today-sync-error', error);
        const retry = $(`today-retry-${kind}`);
        retry.hidden = relogin || !error;
        retry.disabled = busy || (kind === 'schedule' ? state.checking : !!state.homework?.checking);
      }
      $('today-refresh').disabled = relogin || busy || state.checking || !!state.homework?.checking;
    }

    function lessonCard(id, label, lessons, empty) {
      const children = [node('h3', label, 'today-slot-label')];
      if (!lessons.length) children.push(node('p', empty, 'today-slot-empty'));
      for (const lesson of lessons) {
        const button = node('button', lesson.title, 'today-lesson-link');
        button.type = 'button';
        button.addEventListener('click', () => perform('open-lesson', lesson.id));
        const line = node('p', `${shortDate.format(lesson.start)} ${lesson.beginTime}–${lesson.endTime}${lesson.room ? ' · ' + lesson.room : ''}`, 'today-slot-meta');
        children.push(button, line);
      }
      $(id).replaceChildren(...children);
    }

    function renderAgenda(state, rows, today, hasUrgentHomework) {
      const key = JSON.stringify([rows, today, hasUrgentHomework, state.connected, !!state.homework?.lastChecked, state.homework?.checking]);
      if (key === agendaKey) return;
      agendaKey = key;
      const taskCount = rows.filter(row => row.kind === 'task').length;
      set('today-agenda-count', `${rows.length - taskCount} 项作业 · ${taskCount} 项待办`);
      const groups = new Map();
      for (const row of rows) {
        const date = dayKey.format(row.at);
        if (!groups.has(date)) {
          const group = node('section', '', 'today-day');
          const heading = node('h4', date === today ? '今天' : dateLabel.format(row.at));
          const list = node('ul', '', 'today-deadlines');
          group.append(heading, list);
          groups.set(date, { group, list });
        }
        const line = deadlineItem({ ...row, time: row.dateOnly ? '仅日期' : timeLabel.format(row.at),
          label: row.kind === 'task' ? '待办' : '作业' }, () => {
          if (row.kind === 'homework') return perform('open-homework', row.id);
          selectView('campus');
          window.dispatchEvent(new CustomEvent('course-open-notice', { detail: row.id }));
        });
        groups.get(date).list.append(line);
      }
      const empty = state.homework?.checking ? '正在同步作业…' : state.homework?.lastChecked
        ? hasUrgentHomework ? '这 7 天内没有其他到期事项' : '这 7 天内没有到期的待交作业或已确认待办'
        : state.connected ? '同步作业后会在这里显示截止日期' : '登录学校后查看作业和个人待办';
      $('today-agenda-list').replaceChildren(...(rows.length ? [...groups.values()].map(entry => entry.group)
        : [node('p', empty, 'today-agenda-empty')]));
    }

    return {
      render(state, busy) {
        if ($('today-panel').hidden) return;
        const now = Date.now();
        const today = dayKey.format(now);
        const firstDay = Date.parse(today + 'T00:00:00+08:00');
        const end = firstDay + 7 * dayMs;
        set('today-date', dateLabel.format(now));
        set('today-range', `${shortDate.format(firstDay)}–${shortDate.format(end - 1)}，含今天`);
        const current = state.schedule.filter(lesson => lesson.start <= now && now < lesson.end);
        const next = state.schedule.find(lesson => lesson.start > now);
        const empty = state.lastSchedule ? '' : state.checking ? '正在同步课表…' : state.connected ? '请同步课表' : '登录后查看课表';
        const key = JSON.stringify([current, next, empty]);
        if (key !== timetableKey) {
          timetableKey = key;
          $('today-current').classList.toggle('today-current-active', current.length > 0);
          lessonCard('today-current', '当前课次', current, empty || '现在没有课');
          lessonCard('today-next', '下一节课', next ? [next] : [], empty || '已同步课表中没有下一节');
        }
        const signins = activeSignins(state, now);
        const [status, target] = monitorCopy(state, next, signins.length);
        set('today-status-label', status);
        set('today-monitor-target', target);
        $('today-status').classList.toggle('is-running', state.running && !['sleeping', 'error'].includes(state.phase));
        $('today-status').classList.toggle('today-status-error', ['error', 'login-required'].includes(state.phase));
        const previous = state.lastSigninCheck;
        const time = previous && (dayKey.format(previous) === today ? checkTime.format(previous) : shortDate.format(previous) + ' ' + checkTime.format(previous));
        set('today-last-check', time ? `${time} · ${state.lastSigninLesson.title}` : '尚未检查课堂活动');
        const seconds = state.nextCheck ? Math.max(0, Math.ceil((state.nextCheck - now) / 1000)) : 0;
        set('today-next-check', state.checking && state.phase !== 'sleeping' ? '正在检查'
          : state.running && state.nextCheck ? `${checkTime.format(state.nextCheck)}（${seconds} 秒后）` : '—');
        const toggle = $('today-monitor-toggle');
        const needsLogin = !state.connected && state.phase !== 'error';
        set(toggle.id, state.running ? '暂停监控' : needsLogin ? '连接学校' : '开始监控');
        toggle.disabled = !state.running && (busy || state.checking);
        renderSync(state, busy);
        const rows = deadlineRows(state, now, firstDay, end);
        const isDueToday = row => row.kind === 'homework' && row.at < firstDay + dayMs;
        const dueToday = rows.filter(isDueToday);
        renderUrgent(state, signins, dueToday, today);
        renderAgenda(state, rows.filter(row => !isDueToday(row)), today, dueToday.length > 0);
      }
    };
  }

  return { create };
})();
