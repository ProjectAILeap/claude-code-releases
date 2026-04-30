#!/usr/bin/env node

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { readdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function computeSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const version = process.argv[2];

  if (!version) {
    console.error(chalk.red('❌ Usage: node verify-checksums.js <version>'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n🔐 Verifying checksums for Claude Desktop v${version}...\n`));

  const downloadDir = join(__dirname, '..', '..', 'downloads', `desktop-${version}`);

  const files = await readdir(downloadDir);
  const installers = files.filter(f =>
    (f.startsWith('Claude-') || f.startsWith('ClaudeSetup-')) &&
    (f.endsWith('.dmg') || f.endsWith('.exe'))
  );

  if (installers.length === 0) {
    console.error(chalk.red(`❌ No installer files found in ${downloadDir}`));
    process.exit(1);
  }

  const checksums = {};
  const results = [];

  for (const file of installers) {
    const filePath = join(downloadDir, file);
    console.log(chalk.blue(`\n🔍 Computing SHA-256 for ${file}...`));

    try {
      const hash = await computeSHA256(filePath);
      console.log(chalk.green(`✅ ${hash}`));

      // Extract platform key from filename: Claude-1.5354.0-darwin-universal.dmg -> darwin-universal
      const match = file.match(/^(?:Claude|ClaudeSetup)-[^-]+-(.+)\.(dmg|exe)$/);
      if (match) {
        checksums[match[1]] = hash;
      }
      results.push({ file, status: 'success', hash });
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      results.push({ file, status: 'error', error: error.message });
    }
  }

  const checksumsPath = join(downloadDir, 'checksums.json');
  await writeFile(checksumsPath, JSON.stringify(checksums, null, 2));
  console.log(chalk.green(`\n✅ Checksums saved to ${checksumsPath}`));

  console.log(chalk.bold(`\n📋 Verification Summary:`));
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'error');

  console.log(chalk.green(`✅ Computed: ${successful.length}/${installers.length}`));

  if (failed.length > 0) {
    console.log(chalk.red(`❌ Failed: ${failed.length}`));
    failed.forEach(f => {
      console.log(chalk.red(`   - ${f.file}: ${f.error}`));
    });
    process.exit(1);
  }

  console.log(chalk.green(`\n✨ All checksums computed successfully!`));
}

main().catch(error => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
  process.exit(1);
});
