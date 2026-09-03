import { Client } from 'basic-ftp';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { REPORTS_BASE } from './paths.js';

export function getFtpConfig() {
  if (!process.env.FTP_HOST || !process.env.FTP_USER) return null;
  return {
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD || '',
    secure: process.env.FTP_SECURE === 'true',
    remotePath: (process.env.FTP_REMOTE_PATH || '').replace(/\/$/, ''),
  };
}

export async function ftpDownload(ftpConfig, remotePath) {
  if (!ftpConfig) return null;
  const client = new Client(60_000);
  try {
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      secure: ftpConfig.secure,
    });
    const fullPath = ftpConfig.remotePath ? `${ftpConfig.remotePath}/${remotePath}` : remotePath;
    const localFile = join(REPORTS_BASE, remotePath);
    const dir = dirname(localFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await client.downloadTo(localFile, fullPath);
    return readFileSync(localFile, 'utf8');
  } catch {
    return null;
  } finally {
    client.close();
  }
}

export async function ftpUpload(ftpConfig, localPath, remotePath) {
  if (!ftpConfig) return;
  const client = new Client(60_000);
  try {
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      secure: ftpConfig.secure,
    });
    const fullRemote = ftpConfig.remotePath ? `${ftpConfig.remotePath}/${remotePath}` : remotePath;
    const remoteDir = dirname(fullRemote);
    if (remoteDir !== '.') await client.ensureDir(remoteDir);
    await client.uploadFrom(localPath, fullRemote);
  } catch (err) {
    console.error('FTP upload failed:', err.message);
  } finally {
    client.close();
  }
}

export function listScreenshotFiles(reportDir) {
  const shotsDir = join(reportDir, 'screenshots');
  if (!existsSync(shotsDir)) return [];
  try {
    return readdirSync(shotsDir)
      .filter((name) => {
        const p = join(shotsDir, name);
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .map((name) => ({ local: join(shotsDir, name), remote: `screenshots/${name}` }));
  } catch {
    return [];
  }
}

/**
 * Pushes a single run's artifacts to FTP. Layout: <domain>/<runId>/...
 * @param {string} domain
 * @param {string} runId
 * @param {ReturnType<typeof getFtpConfig>} ftpConfig
 */
export async function persistReportArtifactsToFtp(domain, runId, ftpConfig) {
  if (!ftpConfig) return;
  const reportDir = join(REPORTS_BASE, domain, runId);
  const baseFiles = [
    'accessibility-report.html',
    'accessibility-client.html',
    'accessibility-developers.html',
    'accessibility-statement.html',
    'accessibility-results.json',
    'accessibility-results-previous.json',
    'statement-meta.json',
    'manual-progress.json',
    'wcag-analysis.json',
  ];
  const jobs = [];
  baseFiles.forEach((name) => {
    const local = join(reportDir, name);
    if (existsSync(local)) jobs.push({ local, remote: `${domain}/${runId}/${name}` });
  });
  const domainManual = join(REPORTS_BASE, domain, 'manual-progress.json');
  if (existsSync(domainManual)) {
    jobs.push({ local: domainManual, remote: `${domain}/manual-progress.json` });
  }
  listScreenshotFiles(reportDir).forEach((f) => {
    jobs.push({ local: f.local, remote: `${domain}/${runId}/${f.remote}` });
  });
  for (const j of jobs) {
    await ftpUpload(ftpConfig, j.local, j.remote);
  }
}
