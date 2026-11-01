import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
let resources;
const i18n = {
  language: 'zh',
  use() { return this; },
  init(options) { resources = options.resources; this.language = options.lng; return Promise.resolve(); },
  on() {},
};
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const require = name => {
    if (name === 'i18next') return { default: i18n };
    if (name === 'react-i18next') return { initReactI18next: {} };
    assert.ok(name.startsWith('.'), `Unexpected translation dependency: ${name}`);
    return load(resolve(dirname(file), name.endsWith('.ts') ? name : `${name}.ts`));
  };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, require, URLSearchParams,
    window: { location: { search: '' } },
    localStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: {} },
  }, { filename: file });
  return module.exports;
}
function flatten(value, prefix = '', result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'object' && child !== null) flatten(child, path, result);
    else { assert.equal(typeof child, 'string', `${path} must be a string`); result.set(path, child); }
  }
  return result;
}
function interpolations(text) {
  return [...new Set([...text.matchAll(/{{-?\s*([^},\s]+)(?:,[^}]*)?\s*}}/g)].map(match => match[1]))].sort();
}

load(resolve(frontend, 'src/i18n.ts'));
assert.ok(resources?.zh?.translation && resources?.en?.translation, 'Both languages must be registered by i18n.ts');
const zh = flatten(resources.zh.translation);
const en = flatten(resources.en.translation);
const issues = [];
for (const key of zh.keys()) if (!en.has(key)) issues.push(`Missing English key: ${key}`);
for (const key of en.keys()) if (!zh.has(key)) issues.push(`Missing Chinese key: ${key}`);
for (const [key, value] of en) {
  if (/\p{Script=Han}/u.test(value)) issues.push(`Chinese text in English key: ${key}: ${value}`);
  if (zh.has(key) && JSON.stringify(interpolations(value)) !== JSON.stringify(interpolations(zh.get(key)))) {
    issues.push(`Interpolation mismatch: ${key}: zh=${interpolations(zh.get(key))} en=${interpolations(value)}`);
  }
}
assert.equal(issues.length, 0, issues.join('\n'));

const { openApiEnglish } = load(resolve(frontend, 'src/locales/openapi.ts'));
for (const [source, translated] of Object.entries(openApiEnglish)) {
  assert.equal(typeof translated, 'string', `OpenAPI translation must be a string: ${source}`);
  assert.ok(translated.trim() && !/\p{Script=Han}/u.test(translated), `Invalid English OpenAPI translation: ${source}`);
}
const openapi = JSON.parse(readFileSync(resolve(frontend, 'public/docs/downstream-v1.json'), 'utf8'));
let prosePaths = 0;
function checkProse(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}/${key}`;
    if (['example', 'examples', 'enum'].includes(key)) continue;
    if (['summary', 'description', 'title'].includes(key) && typeof child === 'string' && /\p{Script=Han}/u.test(child)) {
      prosePaths++;
      assert.equal(typeof openApiEnglish[child], 'string', `Missing OpenAPI translation: ${next}`);
      assert.ok(!/\p{Script=Han}/u.test(openApiEnglish[child]), `Chinese text in OpenAPI translation: ${next}`);
    }
    checkProse(child, next);
  }
}
checkProse(openapi);
assert.ok(prosePaths > 0, 'OpenAPI prose coverage must inspect the canonical reference');
console.log(`PASS: ${zh.size} matching zh/en resource keys, no Chinese in English values, matching interpolation names; ${Object.keys(openApiEnglish).length} OpenAPI translations cover ${prosePaths} prose paths. Skipped OpenAPI wire examples and enum values.`);

const { localizeOpenApi } = load(resolve(frontend, 'src/locales/openapiDisplay.ts'));
const canonical = JSON.parse(readFileSync(resolve(frontend, 'public/docs/downstream-v1.json'), 'utf8'));
const original = JSON.stringify(canonical);
assert.equal(localizeOpenApi(canonical, 'zh'), canonical);
const display = localizeOpenApi(canonical, 'en');
assert.notEqual(display, canonical);
assert.equal(JSON.stringify(canonical), original, 'Localized docs must not mutate the canonical API contract');
const sample = { info: { title: '查询虚拟卡' }, paths: {}, example: { description: '查询虚拟卡' }, enum: ['查询虚拟卡'] };
const translated = localizeOpenApi(sample, 'en');
assert.equal(translated.info.title, openApiEnglish['查询虚拟卡']);
assert.deepEqual(translated.example, sample.example);
assert.deepEqual(translated.enum, sample.enum);
console.log('PASS: localized API display preserves canonical data, wire examples and enum values.');
