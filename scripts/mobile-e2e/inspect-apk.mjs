import { execFileSync } from 'node:child_process';
const [aapt, apk] = process.argv.slice(2);
const xml = execFileSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' });
if (!xml.includes('E: manifest') || !xml.includes('E: application')) throw Error('Invalid APK manifest');
const value = xml.match(/android:usesCleartextTraffic[^\n]*=(?:\(type[^)]*\))?(0x[0-9a-f]+)/i)?.[1];
// No attribute uses Android target SDK >=28 default false; require target in badging.
if (!value) {
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' });
  const sdk = Number(badging.match(/targetSdkVersion:'(\d+)'/)?.[1]);
  if (!(sdk >= 28)) throw Error('Cleartext default unknown: target SDK missing or <28');
}
console.log(value && Number(value) !== 0 ? 'true' : 'false');
