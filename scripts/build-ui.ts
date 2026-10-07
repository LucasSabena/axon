import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fingerprintAssets } from './fingerprint-assets';

const result=await Bun.build({entrypoints:['public/ui-components.source.js'],outdir:'public/vendor',naming:'axon-ui.js',target:'browser',minify:true,conditions:['browser','production'],define:{'process.env.NODE_ENV':'"production"'}});
if(!result.success){for(const log of result.logs)console.error(log);process.exit(1);}
await mkdir('public/vendor/webawesome',{recursive:true});
await cp('node_modules/@awesome.me/webawesome/dist/styles','public/vendor/webawesome/styles',{recursive:true});

// Browser/CDN caches can keep assets for hours — even past a deploy. Every
// ?v= reference to a shipped file gets a content-derived URL on each build;
// manual bumps proved lossy and a stale asset under a recycled version
// string is worse than no version at all.
await fingerprintAssets('public');
const shell=await readFile('public/index.html','utf8');

// The service-worker cache name tracks the shipped asset set: a changed build
// means a changed sw.js, which means a clean cache on activation — no
// cross-version asset mixing is possible.
const swOriginal=await readFile('public/sw.js','utf8');
const swSrc=swOriginal.replace(/const CACHE = 'axon-[^']*'/,"const CACHE = 'axon-__CACHE_STAMP__'");
// A silent no-op here would ship a stale cache name across releases.
if(swSrc===swOriginal)throw new Error("public/sw.js: `const CACHE = 'axon-…'` stamp point not found; refusing to ship an unversioned service-worker cache");
const stamp=createHash('sha256').update(shell).update(swSrc).digest('hex').slice(0,12);
await writeFile('public/sw.js',swSrc.replace('axon-__CACHE_STAMP__',`axon-${stamp}`));
console.log(`Local Web Awesome bundle: ${result.outputs[0].size} bytes`);
