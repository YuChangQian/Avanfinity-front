import fs from 'node:fs';
const contract = JSON.parse(fs.readFileSync(new URL('../openapi/downstream-v2.json', import.meta.url), 'utf8'));
function type(s) {
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map(v => `(${type(v)})`).join(' | ');
  if (s.$ref) return s.$ref.split('/').at(-1);
  if (s.enum) return s.enum.map(JSON.stringify).join(' | ');
  if (Array.isArray(s.type)) return s.type.map(t => type({ ...s, type: t })).join(' | ');
  if (s.type === 'array') return `Array<${type(s.items)}>`;
  if (s.type === 'object') {
    if (!s.properties || Object.keys(s.properties).length === 0) return 'Record<string, unknown>';
    return `{ ${Object.entries(s.properties).map(([k,v]) => `${k}${s.required?.includes(k) ? '' : '?'}: ${type(v)}`).join('; ')} }`;
  }
  return { integer:'number', number:'number', string:'string', boolean:'boolean', null:'null' }[s.type] ?? 'unknown';
}
const result = '// Generated from openapi/downstream-v2.json. Run node scripts/generate-cdk-v2.mjs.\n' + Object.entries(contract.components.schemas).map(([name,s]) => `export type ${name} = ${type(s)};`).join('\n') + '\n';
const file = new URL('../src/generated/cdk-v2.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(file,'utf8') !== result) throw new Error('CDK v2 types are stale');
} else fs.writeFileSync(file,result);
