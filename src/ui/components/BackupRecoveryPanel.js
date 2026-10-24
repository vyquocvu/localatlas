import { useState } from 'react';
import { html, Button, Card } from './Common.js';

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

export function BackupRecoveryPanel() {
  const [targetDir, setTargetDir] = useState('');
  const [backupDir, setBackupDir] = useState('');
  const [status, setStatus] = useState('');
  const [backup, setBackup] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [busy, setBusy] = useState(false);

  const createBackup = async () => {
    setBusy(true); setStatus('Creating and verifying backup…'); setBackup(null);
    try {
      const result = await postJson('/api/workspace/backup', { targetDir });
      setBackup(result);
      setBackupDir(result.backupDir);
      setStatus('Backup created and every manifest checksum verified.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const inspectBackup = async () => {
    setBusy(true); setStatus('Verifying backup manifest and checksums…'); setInspection(null);
    try {
      const result = await postJson('/api/workspace/backup/inspect', { backupDir });
      setInspection(result);
      setStatus('Backup verification passed.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return html`
    <${Card} className="backup-recovery-card">
      <div class="content-section-heading"><div><h2>Backup & recovery</h2><p>Protect the LocalAtlas workspace without touching imported repositories.</p></div></div>
      <div class="backup-recovery-grid">
        <div class="backup-action">
          <label for="backup-target-path">Backup destination</label>
          <input id="backup-target-path" class="atlas-input" value=${targetDir} onChange=${event => setTargetDir(event.target.value)} placeholder="/path/outside-your-workspaces/localatlas-backup" />
          <${Button} className="button--primary" onClick=${createBackup} isDisabled=${busy || !targetDir.trim()}>Create and verify backup</${Button}>
        </div>
        <div class="backup-action">
          <label for="backup-inspect-path">Inspect a backup before restore</label>
          <input id="backup-inspect-path" class="atlas-input" value=${backupDir} onChange=${event => setBackupDir(event.target.value)} placeholder="/path/to/localatlas-backup" />
          <${Button} onClick=${inspectBackup} isDisabled=${busy || !backupDir.trim()}>Verify backup and preflight</${Button}>
        </div>
      </div>
      ${status && html`<p class="backup-status" role="status">${status}</p>`}
      ${backup && html`<div class="backup-result"><strong>Backup verified</strong><span>${backup.backupDir}</span><small>${backup.projectsCount} projects · ${backup.docsCount} documents · ${backup.verification.filesCount} checksums verified</small></div>`}
      ${inspection && html`
        <div class="backup-result"><strong>Restore preflight passed</strong><span>Created ${inspection.createdAt} · ${inspection.projectsCount} projects · ${inspection.docsCount} documents · ${inspection.filesCount} checksums verified</span><span>Target workspace: ${inspection.targetHome}</span>
          ${inspection.restoreRequiresForce
            ? html`<strong class="backup-warning">The target workspace contains data. Restore requires --force and replaces that workspace.</strong>`
            : html`<small>The target workspace is empty; restore does not require --force.</small>`}
          <small>Restore requires stopping LocalAtlas first. Then run: <code>npm run cli -- restore "${inspection.backupDir}"${inspection.restoreRequiresForce ? ' --force' : ''}</code></small>
        </div>
      `}
      <p class="backup-help">Choose an absolute destination outside LOCALATLAS_HOME and every imported source repository. Restore is deliberately offline; the preflight verifies the archive and shows conflicts before you run the CLI.</p>
    </${Card}>
  `;
}
