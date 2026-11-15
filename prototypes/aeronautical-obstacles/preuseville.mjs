#!/usr/bin/env node
/** Compatibility entry point; all three zones use the same pipeline. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZone } from './build.mjs';
export const buildPreuseville = (studyPath, outputPath) => buildZone('preuseville', studyPath, outputPath);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--study', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: preuseville.mjs [--study directory] [--output new-directory-outside-git]');
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(await buildPreuseville(options['--study'] ?? '/tmp/bc-obstacles-study', options['--output']), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
