import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Copy the starting files into a home folder, recursively, without overwriting
 * anything already there: your persona and memory are yours once they exist.
 * Returns the paths it created, relative to `to`.
 */
export async function copyTemplates(from: string, to: string, prefix = ''): Promise<string[]> {
  await mkdir(to, { recursive: true, mode: 0o700 });
  const created: string[] = [];
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      created.push(...(await copyTemplates(source, target, `${prefix}${entry.name}/`)));
      continue;
    }
    if (entry.name === '.gitkeep') continue;
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (exists) continue;
    await copyFile(source, target);
    created.push(prefix + entry.name);
  }
  return created;
}
