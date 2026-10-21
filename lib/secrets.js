// Optional API keys. Environment variables win; otherwise keys saved from the
// settings panel live in data/secrets.json on this machine only.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export class Secrets {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'secrets.json');
    this.data = {};
    if (existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    }
  }

  get githubToken() { return process.env.GITHUB_TOKEN || this.data.githubToken || ''; }
  get anthropicKey() { return process.env.ANTHROPIC_API_KEY || this.data.anthropicKey || ''; }
  get profile() { return this.data.profile || ''; }

  update(patch) {
    for (const k of ['githubToken', 'anthropicKey', 'profile']) {
      if (typeof patch[k] !== 'string') continue;
      const v = patch[k].trim();
      if (v) this.data[k] = v.slice(0, k === 'profile' ? 600 : 300);
      else delete this.data[k];
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  flags() {
    return {
      github: !!this.githubToken,
      githubFromEnv: !!process.env.GITHUB_TOKEN,
      anthropic: !!this.anthropicKey,
      anthropicFromEnv: !!process.env.ANTHROPIC_API_KEY,
      profile: this.profile,
    };
  }
}
