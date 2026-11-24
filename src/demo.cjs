class DemoApi {
  constructor(now = Date.now) { this.now = now; this.scenario = 'empty'; this.eventId = 90001; this.calls = 0; }
  async result(data) {
    this.calls++;
    if (this.scenario === 'offline') { const { MonitorError } = require('./core.cjs'); throw new MonitorError('network', '网络连接中断，将自动重试'); }
    if (this.scenario === 'expired') { const { MonitorError } = require('./core.cjs'); throw new MonitorError('auth', '登录已过期，请重新登录学校'); }
    return { scope: 'DEMO-ACCOUNT-TERM', data };
  }
  async schedule() {
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    const day = Math.floor((this.now() + 8 * 3600000) / 86400000);
    const firstMonday = (day - ((day + 3) % 7) - 7) * 86400000 - 8 * 3600000;
    const result = await this.result([{ dayList: [
      { date: format.format(this.now()), courseList: [{ courseId: 810083, courseNo: '31090083', courseSeq: '01', courseName: '市场调查与分析', weekTimeId: 2128489, beginTime: '00:00', endTime: '23:59', address: '教学楼 A301' }] },
      { date: format.format(this.now() + 86400000), courseList: [{ courseId: 810050, courseNo: '31090050', courseSeq: '01', courseName: '数理统计', weekTimeId: 2128490, beginTime: '09:00', endTime: '10:30', address: '教学楼 B204' }] }
    ] }]);
    return { ...result, calendar: { week: 2, weekCount: 4, firstMonday, loadedWeeks: [2, 3] } };
  }
  async termSchedule(validateScope) {
    const { normalizeSchedule } = require('./core.cjs');
    const { summarizeCourses } = require('./shared/timetable.cjs');
    const result = await this.schedule();
    validateScope(result.scope);
    const { firstMonday } = result.calendar;
    const current = normalizeSchedule(result.data);
    const lessons = [
      ...current.map(lesson => ({ ...lesson, id: lesson.id + '1', start: lesson.start - 7 * 86400000, end: lesson.end - 7 * 86400000, date: new Date(lesson.start - 7 * 86400000 + 8 * 3600000).toISOString().slice(0, 10) })),
      ...current
    ];
    return {
      name: '演示学期', firstMonday, start: firstMonday, end: firstMonday + 28 * 86400000 - 1,
      weekCount: 4, week: 2, checkedAt: this.now(), lessons, courses: summarizeCourses(lessons, firstMonday)
    };
  }
  async weekSchedule(scope, week) {
    const term = await this.termSchedule(value => {
      if (value !== scope) throw new Error('演示课表账号已变化');
    });
    const start = term.firstMonday + (week - 1) * 7 * 86400000;
    return term.lessons.filter(lesson => lesson.start >= start && lesson.start < start + 7 * 86400000);
  }
  async list() { return this.result(['empty', 'exercise'].includes(this.scenario) ? null : [{ id: this.eventId, title: '课堂签到（模拟）', type: 2, signStatus: this.scenario === 'ended' ? '3' : '1' }]); }
  async exercises() {
    return this.result(this.scenario === 'exercise'
      ? [{ id: 91001, description: '抽样与样本量（模拟练习）', exerciseStatus: 1, studentExerciseStatus: 0 }]
      : []);
  }
  async detail() { return this.result({ signStatus: 0, signInModel: { status: 1, startTime: new Date(this.now()-60000).toISOString(), endTime: new Date(this.now()+10*60000).toISOString() } }); }
  async homeworkList() {
    const courses = ['数理统计','市场调查与分析','政治经济学','社会统计学'];
    return this.result(courses.map((courseName,index) => ({ courseName, courseNo:String(31090050+index), courseSeq:'01', teacherName:'示例教师', paperId:String(80000+index), weekTimeId:String(20000+index), weekTime:'10', week:'2', section:'1', continunity:'2', homeworkStatus:['1','1','3','4'][index], endDate:new Date(this.now()+[48,36,12,-24][index]*3600000).toISOString(), score:null })));
  }
  async homeworkDetail(item) { return this.result({paperId:item.paperId,paperName:{80000:'参数估计与假设检验',80001:'问卷设计与调查报告',80002:'资本与剩余价值',80003:'统计图表练习'}[item.paperId] || '新发布作业'}); }
}
module.exports = { DemoApi };
