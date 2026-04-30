#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(__dirname, '..', 'README.md');

const USAGE = 'Usage: node update-readme-version.js <cli|desktop> <version>';

async function main() {
  const type = process.argv[2];
  const version = process.argv[3];

  if (!type || !version || !['cli', 'desktop'].includes(type)) {
    console.error(USAGE);
    process.exit(1);
  }

  const date = new Date().toISOString().split('T')[0];
  let readme = await readFile(README_PATH, 'utf-8');

  if (type === 'cli') {
    readme = readme.replace(
      /\| \*\*Claude Code CLI\*\* \| `v[^`]+` \| \d{4}-\d{2}-\d{2} \| \[Release\]\([^)]+\) \|/,
      `| **Claude Code CLI** | \`v${version}\` | ${date} | [Release](../../releases/tag/v${version}) |`
    );
  } else {
    readme = readme.replace(
      /\| \*\*Claude Desktop App\*\* \| `v[^`]+` \| \d{4}-\d{2}-\d{2} \| \[Release\]\([^)]+\) \|/,
      `| **Claude Desktop App** | \`v${version}\` | ${date} | [Release](../../releases/tag/desktop-v${version}) |`
    );
  }

  await writeFile(README_PATH, readme);
  console.log(`Updated README.md: ${type} -> v${version} (${date})`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
