export type MediaKind = 'text' | 'voice-script' | 'avatar-video' | 'podcast';

export interface MediaGenerationRequest {
  kind: MediaKind;
  title: string;
  brief: string;
  channel?: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp';
}

export interface MediaGenerationResult {
  kind: MediaKind;
  title: string;
  assets: Array<{ type: 'text' | 'audio' | 'video'; uri: string }>;
  notes: string[];
}

export class MediaGenerationServiceStub {
  async generate(input: MediaGenerationRequest): Promise<MediaGenerationResult> {
    if (input.kind === 'text') {
      return {
        kind: input.kind,
        title: input.title,
        assets: [{ type: 'text', uri: `inline://text/${encodeURIComponent(input.title)}` }],
        notes: ['Generazione testo pronta in modalità stub'],
      };
    }

    if (input.kind === 'voice-script') {
      return {
        kind: input.kind,
        title: input.title,
        assets: [{ type: 'audio', uri: `inline://audio/${encodeURIComponent(input.title)}` }],
        notes: ['Script voce generato, pronto per TTS provider'],
      };
    }

    if (input.kind === 'avatar-video') {
      return {
        kind: input.kind,
        title: input.title,
        assets: [{ type: 'video', uri: `inline://video/${encodeURIComponent(input.title)}` }],
        notes: ['Output avatar video predisposto, renderer esterno non collegato'],
      };
    }

    return {
      kind: input.kind,
      title: input.title,
      assets: [{ type: 'audio', uri: `inline://podcast/${encodeURIComponent(input.title)}` }],
      notes: ['Podcast multi-voice predisposto, pipeline media esterna demandata'],
    };
  }
}
