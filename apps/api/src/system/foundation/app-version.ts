import { existsSync, readFileSync } from 'fs';
import path from 'path';

const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function resolveFromVersionFile() {
  const candidates = [
    path.join(process.cwd(), '..', '..', 'VERSION'),
    path.join(process.cwd(), 'VERSION'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const raw = readFileSync(candidate, 'utf8').trim();
      if (semanticVersionPattern.test(raw)) {
        return raw;
      }
    } catch {
      // Ignore and continue to next candidate.
    }
  }

  return '';
}

export function getAppVersion() {
  const envVersion =
    process.env.APP_VERSION?.trim() || process.env.npm_package_version?.trim() || '';
  if (semanticVersionPattern.test(envVersion)) {
    return envVersion;
  }

  return resolveFromVersionFile() || '1.0.0';
}
