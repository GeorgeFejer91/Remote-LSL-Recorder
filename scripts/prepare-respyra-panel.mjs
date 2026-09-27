import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parsePanelDescriptor } from '../web/external-tabs.js';

const source = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide the Respyra checkout after pnpm prepare:web and a source commit.');
if (execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit the validated Respyra source before publishing.');
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const companion = resolve(source, 'companion');
const descriptor = parsePanelDescriptor(await readFile(resolve(companion, 'panel.json'), 'utf8'), 'https://georgefejer91.github.io/Remote-LSL-Recorder/');
if (descriptor.id !== 'respyra-2' || descriptor.url !== 'https://georgefejer91.github.io/Remote-LSL-Recorder/panels/respyra/') throw new Error('Unexpected Respyra descriptor.');
const target = resolve(import.meta.dirname, '../companion/panels/respyra');
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css', 'text-fit.js', 'remote-profile.js', 'panel.json', 'vendor']) await cp(resolve(companion, name), resolve(target, name), { recursive: true });
await writeFile(resolve(target, 'source.json'), JSON.stringify({ repository: 'https://github.com/GeorgeFejer91/respyra-2.0', commit, profile: 'respyra.observer/1' }, null, 2) + '\n');
console.log(`Prepared Respyra static panel from ${commit}`);
