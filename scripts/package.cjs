const path = require('node:path');
const fs = require('node:fs');
(async()=>{
 const { packager }=await import('@electron/packager');
 const root=path.resolve(__dirname,'..');
 const out=path.resolve(root,process.argv[2] || '课堂签到提醒-交付');
 if(!out.startsWith(root+path.sep))throw new Error('构建目录必须位于项目内');
 const productName=require('../package.json').productName;
 const destination=path.join(out,productName+'-win32-x64');
 for(const folder of ['用户数据','演示数据']){
   if(fs.existsSync(path.join(destination,folder)))throw new Error('输出目录已有本地用户资料，请先保留资料并更换构建输出目录，避免覆盖登录状态');
 }
 const localZipDir=process.env.COURSE_DESK_ELECTRON_ZIP_DIR || path.join(root,'课堂签到提醒-交付','构建材料');
 const result=await packager({ dir:root, out, name:productName, executableName:'SignInReminder', platform:'win32', arch:'x64', electronVersion:require('../package.json').devDependencies.electron, electronZipDir:fs.existsSync(path.join(localZipDir,'electron-v45.2.3-win32-x64.zip'))?localZipDir:undefined, tmpdir:path.join(root,'.build-temp'), asar:true, prune:true, overwrite:true, icon:path.join(root,'src/assets/app.ico'), ignore:[/^\/src\/sharing[^/]*\.cjs$/, /^\/src\/ui\/sharing[^/]*\.(js|css)$/,/^\/[^/]*-交付(?:\/|$)/,/^\/(用户数据|演示数据|共享服务数据|sites-sharing|cloudflare-sharing|deploy|mobile)(?:\/|$)/,/^\/release(?:\/|$)/,/^\/test(?:\/|$)/,/^\/test-results(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/.test-/,/^\/.build-temp(?:\/|$)/,/^\/node_modules(?:\/|$)/,/^\/package-lock.json$/], win32metadata:{CompanyName:'Local Tools',FileDescription:productName,ProductName:productName,InternalName:'SignInReminder'}, appCopyright:'Local classroom reminder prototype' });
 for(const output of result){fs.copyFileSync(path.join(root,'README.md'),path.join(output,'使用说明.md'));console.log(output);}
})().catch(error=>{console.error(error);process.exitCode=1;});
