const fs = require('node:fs');
const path = require('node:path');
const { MonitorError } = require('./core.cjs');
class FileStore {
  constructor(directory, filename = 'reminder-state.json') { this.directory = directory; this.file = path.join(directory, filename); }
  read() {
    if (!fs.existsSync(this.file)) return {};
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!value || !Array.isArray(value.records)) throw new Error('Invalid state');
      return value;
    } catch { throw new MonitorError('storage', '本地提醒记录无法读取，请保留数据文件并联系开发者修复'); }
  }
  write(value) {
    try { fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(`${this.file}.tmp`, this.file); }
    catch { throw new MonitorError('storage', '无法保存提醒记录，请检查磁盘空间和目录权限'); }
  }
}
module.exports = { FileStore };
