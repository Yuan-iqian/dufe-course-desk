'use strict';

const TimetableView = (() => {
  const day = 86400000;
  const week = 7 * day;
  const offset = 8 * 3600000;
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const shortDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const updatedAt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const $ = id => document.getElementById(id);
  const range = (start, end) => `${shortDate.format(start)}–${shortDate.format(end)}`;

  function node(tag, label, className) {
    const element = document.createElement(tag);
    if (label) element.textContent = label;
    if (className) element.className = className;
    return element;
  }

  function create({ perform }) {
    let state, selected = 'week', term = null, termError = '', pending = null;
    let revision, renderedWeek = '', renderedTerm = null, syncingWeek = false;
    let weekNumber = null, weekError = '', weekRequest = null, optionKey = '';
    const weekResults = new Map();
    const currentMonday = () => {
      const today = Math.floor((Date.now() + offset) / day);
      return (today - (today + 3) % 7) * day - offset;
    };

    function dayGrid(days, start = null) {
      const grid = node('div', '', 'timetable-grid');
      const now = Date.now();
      for (const [index, name] of weekdays.entries()) {
        const column = node('section', '', 'timetable-day');
        const heading = node('h3');
        heading.append(node('strong', name));
        if (start !== null) {
          const date = start + index * day;
          heading.append(node('span', shortDate.format(date)));
          if (date <= now && now < date + day) column.classList.add('timetable-today');
        }
        column.append(heading);
        if (!days[index].length) column.append(node('p', '无课', 'timetable-no-class'));
        for (const lesson of days[index]) {
          const card = node(start === null ? 'article' : 'button', '', 'timetable-lesson');
          card.append(node('span', `${lesson.beginTime}–${lesson.endTime}`, 'timetable-time'), node('strong', lesson.title));
          if (lesson.weeks) card.append(node('span', lesson.weeks, 'timetable-course-weeks'));
          if (lesson.room) card.append(node('small', lesson.room));
          if (lesson.teacher) card.append(node('small', lesson.teacher));
          if (start !== null) {
            card.type = 'button';
            card.addEventListener('click', () => perform('open-lesson', lesson.id));
          }
          column.append(card);
        }
        grid.append(column);
      }
      return grid;
    }

    function weeklyGrid(monday, lessons) {
      const days = Array.from({ length: 7 }, () => []);
      for (const lesson of lessons) {
        const index = Math.floor((lesson.start - monday) / day);
        if (days[index]) days[index].push(lesson);
      }
      return dayGrid(days, monday);
    }

    function renderTerm() {
      const target = $('timetable-term-content');
      if (!term) {
        renderedTerm = null;
        const message = pending ? '正在逐周读取本学期课表…'
          : !state?.connected ? '登录学校后可查看总课表'
          : termError ? '点击「同步总课表」重试' : '点击「同步总课表」获取本学期课表';
        if (target.textContent !== message) target.replaceChildren(node('p', message, 'timetable-empty'));
        return;
      }
      if (renderedTerm === term) return;
      renderedTerm = term;
      const summary = node('p', `${term.name || '本学期'} · ${range(term.start, term.end)} · ${term.courses.length} 门课程`, 'timetable-term-summary');
      if (!term.courses.length) {
        target.replaceChildren(summary, node('p', '本学期没有已排课的课程', 'timetable-empty'));
        return;
      }
      const days = Array.from({ length: 7 }, () => []);
      for (const course of term.courses) {
        for (const slot of course.slots) {
          days[slot.weekday].push({ ...slot, title: course.title });
        }
      }
      for (const lessons of days) {
        lessons.sort((a, b) => a.beginTime.localeCompare(b.beginTime) || a.endTime.localeCompare(b.endTime) || a.title.localeCompare(b.title, 'zh-CN'));
      }
      target.replaceChildren(summary, dayGrid(days));
    }

    function weekData(calendar, number, monday) {
      const inWeek = lesson => monday <= lesson.start && lesson.start < monday + week;
      if (state.lastSchedule && (!calendar || calendar.loadedWeeks.includes(number))) {
        return { lessons: state.schedule.filter(inWeek), checkedAt: state.lastSchedule };
      }
      if (weekResults.has(number)) return weekResults.get(number);
      if (term && calendar?.firstMonday === term.firstMonday) {
        return { lessons: term.lessons.filter(inWeek), checkedAt: term.checkedAt };
      }
      return null;
    }

    function render(nextState = state) {
      state = nextState;
      if (!state) return;
      if (revision !== state.timetableRevision || !state.connected) {
        revision = state.timetableRevision;
        term = null;
        termError = '';
        pending = null;
        weekNumber = null;
        weekError = '';
        weekRequest = null;
        weekResults.clear();
        $('timetable-term-content').replaceChildren();
        $('timetable-week-content').replaceChildren();
        renderedWeek = '';
      }
      if ($('timetable-panel').hidden) return;
      const showTerm = selected === 'term';
      const sync = $('timetable-sync');
      const calendar = state.calendar;
      const current = calendar?.week;
      const number = weekNumber ?? current;
      const monday = calendar?.firstMonday == null ? currentMonday() : calendar.firstMonday + (number - 1) * week;
      const data = showTerm ? term : weekData(calendar, number, monday);
      const isLoading = showTerm ? !!pending : syncingWeek || !!weekRequest || !data && state.checking;
      sync.disabled = isLoading;
      sync.textContent = isLoading ? '同步中…' : showTerm ? '同步总课表' : '同步课表';
      $('timetable-date').textContent = showTerm ? '本学期 · 按星期查看'
        : `${number ? `第 ${number} 周 · ` : ''}${range(monday, monday + 6 * day)}`;
      $('timetable-status').textContent = data?.checkedAt ? '上次同步 ' + updatedAt.format(data.checkedAt) : state.connected ? '尚未同步' : '请先登录学校';
      const error = showTerm ? termError : weekError || (state.phase === 'error' && !data ? state.error : '');
      $('timetable-error').hidden = !error;
      $('timetable-error').textContent = error;
      $('timetable-week-picker').hidden = showTerm || !calendar || calendar.firstMonday === null;
      if (showTerm) {
        renderTerm();
        if (state.connected && !term && !pending && !termError) void loadTerm();
        return;
      }

      if (calendar) {
        const key = `${calendar.weekCount}:${current}`;
        const selector = $('timetable-week-number');
        if (optionKey !== key) {
          optionKey = key;
          selector.replaceChildren(...Array.from({ length: calendar.weekCount }, (_, index) => {
            const value = index + 1;
            const option = node('option', `第 ${value} 周${value === current ? '（本周）' : ''}`);
            option.value = value;
            return option;
          }));
        }
        selector.value = number;
        $('timetable-prev-week').disabled = number <= 1;
        $('timetable-next-week').disabled = number >= calendar.weekCount;
        $('timetable-current-week').disabled = weekNumber === null;
      }
      const key = JSON.stringify([monday, Math.floor((Date.now() + offset) / day), data?.lessons, state.connected, !data && isLoading]);
      if (key !== renderedWeek) {
        renderedWeek = key;
        $('timetable-week-content').replaceChildren(data ? weeklyGrid(monday, data.lessons)
          : node('p', isLoading ? '正在读取所选周课表…' : state.connected ? '点击「同步课表」读取所选周安排' : '登录学校后查看每周安排', 'timetable-empty'));
      }
    }

    async function loadWeek(number, refresh = false) {
      const request = window.reminder.invoke('week-timetable', { week: number, refresh });
      weekRequest = request;
      render();
      try {
        const result = await request;
        if (request !== weekRequest) return;
        if (!result.ok) throw new Error(result.message);
        weekResults.set(number, result.data);
      } catch (error) {
        if (request === weekRequest) weekError = error.message || '这周的课表同步失败';
      } finally {
        if (request === weekRequest) { weekRequest = null; render(); }
      }
    }

    function chooseWeek(number) {
      weekNumber = number === state.calendar.week ? null : number;
      weekRequest = null;
      weekError = '';
      const monday = state.calendar.firstMonday + (number - 1) * week;
      if (weekData(state.calendar, number, monday)) render();
      else void loadWeek(number);
    }

    async function loadTerm(refresh = false) {
      if (!state?.connected || pending || term && !refresh) return;
      const request = window.reminder.invoke('term-timetable', refresh);
      pending = request;
      termError = '';
      render();
      try {
        const result = await request;
        if (request !== pending) return;
        if (!result.ok) throw new Error(result.message);
        term = result.data;
      } catch (error) {
        if (request === pending) termError = (error.message || '总课表同步失败') + (term ? '。当前显示上次同步结果。' : '');
      } finally {
        if (request === pending) { pending = null; render(); }
      }
    }

    function choose(value) {
      selected = value;
      for (const mode of ['week', 'term']) {
        $('timetable-' + mode).setAttribute('aria-pressed', String(mode === selected));
        $('timetable-' + mode + '-content').hidden = mode !== selected;
      }
      render();
    }

    $('timetable-prev-week').addEventListener('click', () => chooseWeek((weekNumber ?? state.calendar.week) - 1));
    $('timetable-next-week').addEventListener('click', () => chooseWeek((weekNumber ?? state.calendar.week) + 1));
    $('timetable-current-week').addEventListener('click', () => chooseWeek(state.calendar.week));
    $('timetable-week-number').addEventListener('change', event => chooseWeek(Number(event.target.value)));
    $('timetable-week').addEventListener('click', () => choose('week'));
    $('timetable-term').addEventListener('click', () => choose('term'));
    $('timetable-sync').addEventListener('click', async () => {
      if (!state?.connected && !state?.lastSchedule && state?.phase !== 'error') {
        await perform('login');
        if (selected === 'term') await loadTerm();
      } else if (selected === 'term') {
        await loadTerm(true);
      } else if (weekNumber !== null && !state.calendar?.loadedWeeks.includes(weekNumber)) {
        weekError = '';
        await loadWeek(weekNumber, true);
      } else {
        syncingWeek = true;
        render();
        try { await perform('refresh-timetable'); }
        finally { syncingWeek = false; render(); }
      }
    });
    return { render };
  }

  return { create };
})();
