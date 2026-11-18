const encoder=new TextEncoder();
export const hex = bytes => Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
export const randomHex = length => hex(crypto.getRandomValues(new Uint8Array(length)));
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function passwordHash(password,salt,iterations=100000) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations,hash:'SHA-256'},key,256));
}
export function equalDigest(left,right) {
  if(typeof left!=='string'||typeof right!=='string')return false;
  let difference=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++)difference|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);
  return difference===0;
}
