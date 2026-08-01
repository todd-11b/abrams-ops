import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const paths = [...new Set([...tracked, ...untracked])].sort();
const manifest = [];
const aggregate = createHash('sha256');
let bytes = 0;
for (const path of paths) {
  if (!fs.existsSync(path)) {
    manifest.push(`DELETED  0  ${path}`);
    aggregate.update(`${path}\0DELETED\0`);
    continue;
  }
  const content = fs.readFileSync(path);
  const hash = createHash('sha256').update(content).digest('hex');
  manifest.push(`${hash}  ${content.length}  ${path}`);
  aggregate.update(`${path}\0${content.length}\0`); aggregate.update(content); aggregate.update('\0');
  bytes += content.length;
}
console.log(`sha256 ${aggregate.digest('hex')}`);
console.log(`bytes ${bytes}`);
console.log(`paths ${paths.length}`);
console.log(manifest.join('\n'));
