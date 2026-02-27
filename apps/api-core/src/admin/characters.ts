import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { personas } from '@bisp/personas';
import type { CopilotRMPersona } from '@bisp/integrations-eliza';
import { toElizaLikeCharacter } from '@bisp/integrations-eliza';

export type CharacterKey = keyof typeof personas | string;

export interface CharacterProfile extends CopilotRMPersona {
  key: CharacterKey;
  enabled: boolean;
  modelTier: 'small' | 'medium' | 'large';
  systemInstructions: string;
  apiSources: string[];
  updatedAt: string;
}

const DEFAULT_CHARACTERS_PATH = join(
  process.env.COPILOTRM_DATA_DIR ?? join(process.cwd(), '..', '..', 'data'),
  'runtime-characters.json'
);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeProfile(input: Partial<CharacterProfile> & { key: string }, base?: CharacterProfile): CharacterProfile {
  const fallback = base ?? {
    key: input.key,
    name: input.key,
    role: 'custom business agent',
    tone: ['pratico'],
    goals: ['supportare le operazioni commerciali'],
    limits: ['rispettare policy e consensi'],
    channels: ['whatsapp'],
    style: ['chiaro'],
    enabled: true,
    modelTier: 'medium',
    systemInstructions: '',
    apiSources: [],
    updatedAt: nowIso(),
  };
  return {
    ...fallback,
    ...input,
    tone: input.tone ?? fallback.tone,
    goals: input.goals ?? fallback.goals,
    limits: input.limits ?? fallback.limits,
    channels: input.channels ?? fallback.channels,
    style: input.style ?? fallback.style,
    apiSources: input.apiSources ?? fallback.apiSources,
    enabled: input.enabled ?? fallback.enabled,
    modelTier: input.modelTier ?? fallback.modelTier,
    systemInstructions: input.systemInstructions ?? fallback.systemInstructions,
    updatedAt: nowIso(),
  };
}

export class CharacterStudioRepository {
  private profiles = new Map<string, CharacterProfile>();

  constructor(private readonly filePath = DEFAULT_CHARACTERS_PATH) {
    this.bootstrap();
  }

  private bootstrap(): void {
    const baseEntries = Object.entries(personas).map(([key, persona]) =>
      normalizeProfile({
        key,
        ...persona,
        enabled: true,
        modelTier: key === 'content' || key === 'compliance' ? 'large' : 'medium',
        systemInstructions: '',
        apiSources: [],
      })
    );
    baseEntries.forEach((p) => this.profiles.set(p.key, p));

    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CharacterProfile[];
      parsed.forEach((p) => {
        const next = normalizeProfile({ ...p, key: p.key }, this.profiles.get(p.key));
        this.profiles.set(next.key, next);
      });
    } catch {
      // ignore malformed runtime file
    }
  }

  list(): CharacterProfile[] {
    return [...this.profiles.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  get(key: string): CharacterProfile | undefined {
    return this.profiles.get(key);
  }

  upsert(key: string, patch: Partial<CharacterProfile>): CharacterProfile {
    const current = this.profiles.get(key);
    const next = normalizeProfile({ ...patch, key }, current);
    this.profiles.set(key, next);
    return next;
  }

  persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2));
  }

  toElizaLike(key: string): ReturnType<typeof toElizaLikeCharacter> | null {
    const profile = this.profiles.get(key);
    if (!profile) return null;
    const persona: CopilotRMPersona = {
      name: profile.name,
      role: profile.role,
      tone: profile.tone,
      goals: profile.goals,
      limits: profile.limits,
      channels: profile.channels,
      style: profile.style,
    };
    const adapted = toElizaLikeCharacter(persona);
    return {
      ...adapted,
      system: profile.systemInstructions
        ? `${adapted.system}\n\nExtra instructions:\n${profile.systemInstructions}`
        : adapted.system,
    };
  }
}

