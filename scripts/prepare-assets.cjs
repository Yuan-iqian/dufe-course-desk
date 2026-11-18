const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const asset = path.join(root, 'src/assets');
const vendor = path.join(root, 'src/vendor');
fs.mkdirSync(asset,{recursive:true});fs.mkdirSync(vendor,{recursive:true});
const names = ['bell','bell-ring','calendar-days','clock-3','play','pause','external-link','refresh-cw','log-in','settings-2','circle-alert','check','arrow-up-right','x','volume-2','layout-dashboard','book-open','megaphone','chevron-right','palette','qr-code'];
for (const name of names) fs.copyFileSync(path.join(root,'node_modules/lucide-static/icons',`${name}.svg`), path.join(asset,`${name}.svg`));
fs.copyFileSync(path.join(root,'node_modules/lucide-static/LICENSE'),path.join(asset,'LUCIDE-LICENSE'));
fs.copyFileSync(path.join(root,'node_modules/bootstrap/dist/css/bootstrap.min.css'),path.join(vendor,'bootstrap.min.css'));
fs.copyFileSync(path.join(root,'node_modules/bootstrap/LICENSE'),path.join(vendor,'BOOTSTRAP-LICENSE'));
const count=17640, rate=22050, wav=Buffer.alloc(44+count*2);
wav.write('RIFF');wav.writeUInt32LE(36+count*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++){const t=i/rate,local=t<.35?t:t-.35,frequency=t<.35?784:1046.5;wav.writeInt16LE(Math.round(32767*.24*Math.exp(-local*6)*Math.min(1,local*80)*Math.sin(2*Math.PI*frequency*t)),44+i*2);}
fs.writeFileSync(path.join(asset,'chime.wav'),wav);
console.log('Prepared licensed UI assets and chime.');
