// Cuts a release: bumps package.json's version, commits that bump, and
// creates + pushes the matching git tag — the one step that has to stay in
// sync for the in-app update check (App.jsx compares the running
// app.getVersion() against the latest GitHub release tag; if they drift,
// the app is stuck either always or never seeing itself as current). This
// script is the enforcement: there is no other way to bump the version.
//
// Usage: npm run release -- 0.2.0
//
// Does NOT build or sign the DMG — that stays a manual step (see README.md
// "Cutting a release" and CLAUDE.md), so a release can be tagged and pushed
// well before the artifact is ready to upload.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');

function run(cmd) {
  return execSync(cmd, { cwd: root, stdio: 'pipe' }).toString().trim();
}

function fail(msg) {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

const version = process.argv[2];
if (!version) fail('usage: npm run release -- <version>   (e.g. npm run release -- 0.2.0)');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version must look like X.Y.Z, got: ${version}`);

const tag = `v${version}`;

const branch = run('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`must be on main to cut a release (currently on ${branch})`);

const status = run('git status --porcelain');
if (status) fail('working tree is not clean — commit or stash first:\n' + status);

const existingTags = run('git tag -l').split('\n');
if (existingTags.includes(tag)) fail(`tag ${tag} already exists`);

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version === version) fail(`package.json is already at ${version}`);

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

run(`git add ${JSON.stringify(pkgPath)}`);
run(`git commit -m "chore: release ${tag}"`);
run(`git tag -a ${tag} -m "${tag}"`);

console.log(`[release] committed version bump and tagged ${tag}`);
console.log('[release] pushing commit + tag to origin...');
run('git push origin main');
run(`git push origin ${tag}`);

console.log(`[release] done — ${tag} is pushed.`);
console.log(
  '[release] next: npm run electron:build, codesign --sign - --force --deep, then upload ' +
    `release/*.dmg to a new GitHub Release for ${tag} (the DMG artifact name embeds the version).`
);
