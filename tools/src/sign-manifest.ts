import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Manifest } from './schema';

/**
 * Дописывает в манифест подпись пакета. Сам файл подписывает `tauri signer sign`
 * тем же ключом, что и обновления программы; программа ставит пакет только с верной подписью.
 */
export function addSignature(dir: string): void {
  const manifestPath = join(dir, 'manifest.json');
  const manifest = Manifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const sigPath = join(dir, manifest.library.file + '.sig');
  const signature = existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : '';
  if (!signature) throw new Error(`нет подписи пакета: ${sigPath}`);
  manifest.library.signature = signature;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  addSignature(process.argv[2] ?? '../dist-pack');
  console.log('подпись добавлена в манифест');
}
