const { MonitorError, timeValue, normalizeSchedule } = require('../core.cjs');

const DAY = 86400000;
const LAST_WEEK = 26;

function schoolDate(value) {
  if (typeof value !== 'string') return null;
  const date = value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  return timeValue(date.slice(0, 10) + 'T00:00:00');
}

async function readTerm(get) {
  const result = await get('/student/currentDate', {});
  const rawWeek = result.data?.theWeek;
  if (!/^\d+$/.test(String(rawWeek ?? ''))) {
    throw new MonitorError('protocol', '学校返回的教学周无法识别，请在白果云核对课表');
  }
  const week = Math.max(1, Math.min(Number(rawWeek), LAST_WEEK));
  const start = schoolDate(result.data.startDate);
  const end = schoolDate(result.data.endDate);
  const firstMonday = start === null ? null : start - ((new Date(start + 8 * 3600000).getUTCDay() + 6) % 7) * DAY;
  return {
    scope: result.scope, week, start, end, firstMonday,
    name: typeof result.data.batchName === 'string' ? result.data.batchName : ''
  };
}

function readWeek(get, term, weekNo) {
  return get('/student/queryCourseList', { weekNo }).then(result => {
    if (result.scope !== term.scope) throw new MonitorError('auth', '登录账号或学期已变化，请重新同步课表');
    if (result.data === null) return [];
    if (!Array.isArray(result.data)) throw new MonitorError('protocol', '学校返回的课表无法识别');
    return result.data;
  });
}

function termWeekCount(term) {
  if (term.firstMonday === null || term.end === null || term.end < term.start) return LAST_WEEK;
  return Math.min(LAST_WEEK, Math.floor((term.end - term.firstMonday) / (7 * DAY)) + 1);
}

function describeWeeks(weeks) {
  const sorted = [...weeks].sort((a, b) => a - b);
  const ranges = [];
  for (const number of sorted) {
    const previous = ranges.at(-1);
    if (previous && number === previous[1] + 1) previous[1] = number;
    else ranges.push([number, number]);
  }
  return '第 ' + ranges.map(([start, end]) => start === end ? String(start) : `${start}–${end}`).join('、') + ' 周';
}

function summarizeCourses(lessons, firstMonday) {
  const courses = new Map();
  for (const lesson of lessons) {
    const courseKey = `${lesson.courseNo}:${lesson.courseSeq}`;
    const dayIndex = Math.floor((lesson.start - firstMonday) / DAY);
    const week = Math.floor(dayIndex / 7) + 1;
    const weekday = ((dayIndex % 7) + 7) % 7;
    if (!courses.has(courseKey)) {
      courses.set(courseKey, { title: lesson.title, courseNo: lesson.courseNo, courseSeq: lesson.courseSeq, weeks: new Set(), slots: new Map() });
    }
    const course = courses.get(courseKey);
    course.weeks.add(week);
    const { beginTime, endTime, room, teacher } = lesson;
    const slotKey = JSON.stringify([weekday, beginTime, endTime, room, teacher]);
    if (!course.slots.has(slotKey)) course.slots.set(slotKey, { weekday, beginTime, endTime, room, teacher, weeks: new Set() });
    course.slots.get(slotKey).weeks.add(week);
  }
  return [...courses.values()].map(course => ({
    title: course.title, courseNo: course.courseNo, courseSeq: course.courseSeq, weeks: describeWeeks(course.weeks),
    slots: [...course.slots.values()].sort((a, b) => a.weekday - b.weekday || a.beginTime.localeCompare(b.beginTime))
      .map(slot => ({ ...slot, weeks: describeWeeks(slot.weeks) }))
  })).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.courseNo.localeCompare(b.courseNo) || a.courseSeq.localeCompare(b.courseSeq));
}

async function loadTimetable(request, config) {
  const get = (path, params) => request(path, 'GET', params);
  const term = await readTerm(get);
  const { week, end, firstMonday } = term;
  const weeks = [week];
  if (week < LAST_WEEK && (firstMonday === null || end === null || firstMonday + week * 7 * DAY <= end)) {
    weeks.push(week + 1);
  }

  const data = (await Promise.all(weeks.map(weekNo => readWeek(get, term, weekNo)))).flat();
  const calendar = { week, firstMonday, weekCount: termWeekCount(term), loadedWeeks: weeks };
  const selectedInTimetable = data.some(week => week?.dayList?.some?.(day =>
    day?.courseList?.some?.(course => String(course?.weekTimeId) === config.lessonId)
  ));
  if (config.mode === 'manual' && config.courseNo && config.courseSeq && !selectedInTimetable) {
    const manual = await get('/student/queryCourseList', { courseNo: config.courseNo, courseSeq: config.courseSeq });
    if (manual.scope !== term.scope) throw new MonitorError('auth', '登录账号或学期已变化，请重新同步课表');
    return { scope: term.scope, data, calendar, manualData: manual.data };
  }
  return { scope: term.scope, data, calendar };
}

async function loadWeekTimetable(request, scope, weekNo) {
  const data = await readWeek((path, params) => request(path, 'GET', params), { scope }, weekNo);
  return normalizeSchedule(data);
}

async function loadTermTimetable(request, validateScope) {
  const get = (path, params) => request(path, 'GET', params);
  const term = await readTerm(get);
  validateScope(term.scope);
  if (term.firstMonday === null || term.end === null || term.end < term.start) {
    throw new MonitorError('protocol', '学校没有提供完整的学期起止日期，请在白果云核对');
  }
  const weekCount = termWeekCount(term);
  const data = [];
  for (let week = 1; week <= weekCount; week++) {
    validateScope(term.scope);
    data.push(...await readWeek(get, term, week));
  }
  validateScope(term.scope);
  const { scope, ...metadata } = term;
  const lessons = normalizeSchedule(data);
  return { ...metadata, weekCount, lessons, courses: summarizeCourses(lessons, term.firstMonday), checkedAt: Date.now() };
}

module.exports = { loadTimetable, loadTermTimetable, loadWeekTimetable, summarizeCourses };
