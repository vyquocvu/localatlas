import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { stat, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';

const execFileAsync = promisify(execFile);

import type { PickDirectoryResult, DirectoryListing } from './types.js';

export type { PickDirectoryResult, DirectoryListing };

export async function pickDirectory(): Promise<PickDirectoryResult> {
  const platform = process.platform;
  if (process.env.LOCALATLAS_TEST || process.env.NODE_TEST_CONTEXT || process.env.npm_lifecycle_event === 'test') {
    return { supported: true, canceled: true };
  }
  if (platform === 'darwin') {
    const script = `
try
  tell application "System Events"
    activate
  end tell
  set selectedFolder to choose folder with prompt "Select Project Directory to Import"
  return POSIX path of selectedFolder
on error number -128
  return ""
end try
`;
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script]);
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { supported: true, canceled: true };
      }
      return { supported: true, path: resolve(trimmed) };
    } catch (e) {
      return { supported: false, error: (e as Error).message };
    }
  } else if (platform === 'win32') {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Project Directory to Import'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output ''
}
`;
    try {
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { supported: true, canceled: true };
      }
      return { supported: true, path: resolve(trimmed) };
    } catch (e) {
      return { supported: false, error: (e as Error).message };
    }
  } else if (platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select Project Directory to Import',
      ]);
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { supported: true, canceled: true };
      }
      return { supported: true, path: resolve(trimmed) };
    } catch (zenityErr: any) {
      if (zenityErr?.code === 1) {
        return { supported: true, canceled: true };
      }
      try {
        const { stdout } = await execFileAsync('kdialog', [
          '--getexistingdirectory',
          '.',
          'Select Project Directory to Import',
        ]);
        const trimmed = stdout.trim();
        if (!trimmed) {
          return { supported: true, canceled: true };
        }
        return { supported: true, path: resolve(trimmed) };
      } catch (kdialogErr: any) {
        if (kdialogErr?.code === 1) {
          return { supported: true, canceled: true };
        }
        return { supported: false, error: 'No native GUI dialog found on Linux' };
      }
    }
  }
  return { supported: false, error: `Unsupported platform: ${platform}` };
}

export async function listDirectories(targetPath?: string): Promise<DirectoryListing> {
  const home = homedir();
  let dir = targetPath ? resolve(targetPath) : home;
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) {
      dir = dirname(dir);
    }
  } catch {
    dir = home;
  }

  let entries: Dirent[] = [];
  let dirError: string | undefined;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    dirError = (e as Error).message;
    entries = [];
  }

  const subdirs: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      subdirs.push({
        name: entry.name,
        path: join(dir, entry.name),
      });
    }
  }

  subdirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = dirname(dir) !== dir ? dirname(dir) : null;

  return {
    current: dir,
    parent,
    directories: subdirs,
    homedir: home,
    ...(dirError ? { error: dirError } : {}),
  };
}
