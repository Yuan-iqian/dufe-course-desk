'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');
const { MonitorError } = require('./core.cjs');

class SchoolCredentials {
  constructor(directory) {
    this.file = path.join(directory, 'school-credentials.bin');
  }

  async saved() {
    try { await fs.access(this.file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async save(account, password) {
    account = typeof account === 'string' ? account.trim() : '';
    if (!account || account.length > 128 || typeof password !== 'string' || !password || password.length > 256) {
      throw new MonitorError('input', '请输入学校账号和密码');
    }
    if (!safeStorage.isEncryptionAvailable()) throw new MonitorError('storage', '系统加密暂时不可用，请解锁设备后重试');
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ account, password }));
    const temporary = this.file + '.tmp';
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async read() {
    if (!await this.saved()) throw new MonitorError('input', '请先保存学校账号');
    try {
      const bytes = await fs.readFile(this.file);
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(bytes);
      const credentials = JSON.parse(result);
      if (typeof credentials.account !== 'string' || typeof credentials.password !== 'string') throw new Error();
      if (shouldReEncrypt) await this.save(credentials.account, credentials.password);
      return credentials;
    } catch {
      throw new MonitorError('storage', '无法读取已保存账号，请重新保存');
    }
  }

  async clear() {
    await fs.rm(this.file, { force: true });
    await fs.rm(this.file + '.tmp', { force: true });
  }
}

module.exports = { SchoolCredentials };
