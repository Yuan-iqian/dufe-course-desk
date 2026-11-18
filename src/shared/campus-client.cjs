'use strict';

const { EventEmitter } = require('node:events');

function validateDeadline(value) {
  if (value === null || value === '') return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) throw new Error('请输入有效日期和时间');
  const day = value.slice(0, 10);
  const parsed = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('日期不存在');
  if (value.length > 10) {
    const [hour, minute] = value.slice(11).split(':').map(Number);
    if (hour > 23 || minute > 59) throw new Error('时间无效');
    return value + '+08:00';
  }
  return day;
}

class CampusClient extends EventEmitter {
  constructor({ store, fetchPublic, url, clock = Date.now }) {
    super();
    this.store = store;
    this.fetchPublic = fetchPublic;
    this.url = url;
    this.clock = clock;
    this.user = null;
    this.state = store.read();
    this.state.accounts ||= {};
    this.state.records ||= [];
    this.state.cache ||= { items: [], cursor: '', checkedAt: 0, overview: null };
    this.syncing = null;
  }

  snapshot() {
    return { url: this.url, data: this.user ? { user: this.user } : null, online: true };
  }

  setSession(identity) {
    const changed = this.user?.id !== identity?.id;
    this.user = identity || null;
    if (identity && !this.state.accounts[identity.id]) {
      this.state.accounts[identity.id] = {
        baseline: this.clock(),
        preferences: { sources: ['jwc', 'xsc'], keywords: '', notifications: true },
        notices: {}
      };
      this.save();
    }
    if (changed) this.emit('change', this.snapshot());
  }

  save() { this.store.write(this.state); }
  profile() { return this.user ? this.state.accounts[this.user.id] : null; }
  requireProfile() {
    const profile = this.profile();
    if (!profile) throw new Error('请先在学校窗口完成登录');
    return profile;
  }

  pendingDeadlines() {
    const profile = this.profile();
    if (!profile) return [];
    return this.state.cache.items.flatMap(item => {
      const own = profile.notices[item.id];
      return own?.deadline && !own.completed
        ? [{ id: item.id, title: item.title, deadline: own.deadline }]
        : [];
    });
  }

  async sync(force = false) {
    if (this.syncing) return this.syncing;
    if (!force && this.state.cache.overview && this.clock() - this.state.cache.checkedAt < 60000) return;
    this.syncing = this.updateCache().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async updateCache() {
    const overview = await this.fetchPublic('overview');
    const previousTime = Number(this.state.cache.cursor.split(':')[0]) || 0;
    let cursor = previousTime ? `${Math.max(0, previousTime - 120000)}:` : '';
    const items = new Map(this.state.cache.items.map(item => [item.id, item]));
    for (let page = 0; page < 100; page++) {
      const feed = await this.fetchPublic('feed?cursor=' + encodeURIComponent(cursor));
      for (const item of feed.items) items.set(item.id, item);
      cursor = feed.cursor;
      if (!feed.more) {
        this.state.cache = { items: [...items.values()], cursor, checkedAt: this.clock(), overview };
        this.save();
        return;
      }
    }
    throw new Error('公告数量过多，请稍后继续同步');
  }

  decorate(item, profile) {
    const own = profile?.notices[item.id] || {};
    return {
      ...item,
      read: !profile || (own.readRevision == null ? item.updatedAt <= profile.baseline : own.readRevision >= item.revision),
      completed: !!own.completed,
      deadline: own.deadline == null ? item.detectedDeadline ?? item.deadline : own.deadline,
      deadlineConfirmed: own.deadline != null
    };
  }

  followed(item, profile) {
    const { sources, keywords } = profile.preferences;
    const words = keywords.toLowerCase().split(/[，,\n]/).map(word => word.trim()).filter(Boolean);
    return sources.includes(item.sourceId) && (!words.length || words.some(word => item.title.toLowerCase().includes(word)));
  }

  async campusRequest({ path, body }) { return this.request(path, body); }

  async request(route, body) {
    if (typeof route !== 'string' || route.length > 1600) throw new Error('无效的公告操作');
    const address = new URL(route, 'https://local.invalid/');
    const operation = address.pathname.slice(1);
    const params = address.searchParams;
    if (body !== undefined) return this.mutate(operation, body);
    if (!['overview', 'notices', 'notice', 'alerts'].includes(operation)) throw new Error('不支持的公告操作');
    let cached = false;
    try { await this.sync(); }
    catch (error) {
      if (!this.state.cache.overview || operation === 'alerts') throw error;
      cached = true;
    }
    const profile = this.profile();
    const all = this.state.cache.items.map(item => this.decorate(item, profile));
    if (operation === 'overview') {
      return {
        ...this.state.cache.overview,
        preferences: profile?.preferences || null,
        summary: { total: all.length, unread: all.filter(item => !item.read).length, completed: all.filter(item => item.completed).length },
        cached, checkedAt: this.state.cache.checkedAt
      };
    }
    if (operation === 'notice') {
      const id = params.get('id');
      if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('公告编号无效');
      try {
        const detail = await this.fetchPublic('notice?id=' + id);
        const index = this.state.cache.items.findIndex(item => item.id === id);
        if (index >= 0) this.state.cache.items[index] = detail.notice;
        this.save();
        return { notice: this.decorate(detail.notice, this.profile()) };
      } catch (error) {
        const item = all.find(row => row.id === id);
        if (!item) throw error;
        return { notice: item, cached: true };
      }
    }
    if (operation === 'alerts') {
      this.requireProfile();
      const since = Number(params.get('since'));
      if (!Number.isFinite(since)) throw new Error('提醒检查时间无效');
      return {
        items: profile.preferences.notifications ? all.filter(item => !item.read && !item.completed && item.updatedAt >= since && this.followed(item, profile)) : [],
        serverTime: this.clock(), more: false
      };
    }
    const view = params.get('view') || 'all';
    if (!['all', 'following', 'unread', 'completed'].includes(view)) throw new Error('筛选项无效');
    if (view !== 'all') this.requireProfile();
    const query = (params.get('q') || '').toLowerCase();
    const range = params.get('range') || '30';
    if (!['all', '7', '30'].includes(range)) throw new Error('日期范围无效');
    const earliest = range === 'all' ? '' : new Date(this.clock() - Number(range) * 86400000).toISOString().slice(0, 10);
    const items = all.filter(item => {
      if (params.get('source') && item.sourceId !== params.get('source')) return false;
      if (params.get('category') && item.category !== params.get('category')) return false;
      if (query && !(item.title + ' ' + (item.summary || '')).toLowerCase().includes(query)) return false;
      if (range !== 'all' && item.publishedAt < earliest) return false;
      if (view === 'unread') return !item.read;
      if (view === 'completed') return item.completed;
      if (view === 'following') return this.followed(item, profile);
      return true;
    }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const page = Math.max(1, Number(params.get('page')) || 1);
    return { items: items.slice((page - 1) * 20, page * 20), total: items.length, page, pageSize: 20 };
  }

  async mutate(operation, body) {
    const profile = this.requireProfile();
    if (operation === 'refresh') {
      await this.sync(true);
      return { message: '已同步云端最新公告' };
    }
    if (operation === 'preferences') {
      const available = this.state.cache.overview?.sources.map(source => source.id) || [];
      if (!Array.isArray(body.sources) || body.sources.some(id => !available.includes(id))) throw new Error('关注来源无效');
      if (typeof body.keywords !== 'string' || body.keywords.length > 120 || typeof body.notifications !== 'boolean') throw new Error('关注设置无效');
      profile.preferences = { sources: [...new Set(body.sources)], keywords: body.keywords, notifications: body.notifications };
    } else if (operation === 'state') {
      const item = this.state.cache.items.find(row => row.id === body.id);
      if (!item) throw new Error('公告不存在，请先同步');
      const next = { ...profile.notices[item.id] };
      if (body.field === 'read' && typeof body.value === 'boolean') next.readRevision = body.value ? item.revision : 0;
      else if (body.field === 'completed' && typeof body.value === 'boolean') next.completed = body.value;
      else if (body.field === 'deadline') next.deadline = validateDeadline(body.value);
      else throw new Error('个人状态无效');
      profile.notices[item.id] = next;
    } else throw new Error('不支持的公告操作');
    this.save();
    if (operation === 'state' && ['deadline', 'completed'].includes(body.field)) this.emit('tasks-changed');
    return { saved: true };
  }
}

module.exports = { CampusClient, validateDeadline };
