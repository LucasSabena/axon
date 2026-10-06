import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const result=await Bun.build({entrypoints:['public/ui-components.source.js'],outdir:'public/vendor',naming:'axon-ui.js',target:'browser',minify:true,conditions:['browser','production'],define:{'process.env.NODE_ENV':'"production"'}});
if(!result.success){for(const log of result.logs)console.error(log);process.exit(1);}
await mkdir('public/vendor/webawesome',{recursive:true});
await cp('node_modules/@awesome.me/webawesome/dist/styles','public/vendor/webawesome/styles',{recursive:true});
// Browser/CDN caches can keep the previous library player for hours. Give
// its scripts and styles a content-derived URL on every local or Docker build.
let shell = await readFile('public/index.html', 'utf8');
for (const filename of ['feat-library.js', 'feat-library.css']) {
  const version = createHash('sha256').update(await readFile('public/' + filename)).digest('hex').slice(0, 12);
  const reference = new RegExp(`(/${filename.replace('.', '\\.')}\\?v=)[^"\\s]+`, 'g');
  if (!reference.test(shell)) throw Error('Missing library asset reference: ' + filename);
  reference.lastIndex = 0;
  shell = shell.replace(reference, (_, prefix) => prefix + version);
}
await writeFile('public/index.html', shell);
console.log(`Local Web Awesome bundle: ${result.outputs[0].size} bytes`);
