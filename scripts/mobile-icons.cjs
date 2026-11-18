const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
  const bell=fs.readFileSync(path.join(root,'src/assets/bell.svg'),'utf8').replace('<svg','<svg style="width:62%;height:62%;color:white"');
  await page.setContent('<html><style>html,body{margin:0;width:100%;height:100%;background:#2563eb}body{display:flex;align-items:center;justify-content:center}</style><body>'+bell+'</body></html>');
  await page.screenshot({path:path.join(root,'mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')});
  for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})){
   await page.setViewportSize({width:size,height:size});
   for(const name of ['ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png'])await page.screenshot({path:path.join(root,'mobile/android/app/src/main/res/mipmap-'+density,name)});
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
