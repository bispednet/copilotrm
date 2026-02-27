export interface CopilotRMPersona {
  name: string;
  role: string;
  tone: string[];
  goals: string[];
  limits: string[];
  channels: string[];
  style: string[];
}

export interface ElizaLikeCharacter {
  name: string;
  system: string;
  bio: string[];
  lore: string[];
  messageExamples: Array<Array<{ user: string; content: { text: string } }>>;
}

export function toElizaLikeCharacter(persona: CopilotRMPersona): ElizaLikeCharacter {
  return {
    name: persona.name,
    system: `${persona.role}. Tono: ${persona.tone.join(', ')}. Obiettivi: ${persona.goals.join('; ')}. Limiti: ${persona.limits.join('; ')}.`,
    bio: persona.style,
    lore: [`Agente CopilotRM specializzato per ${persona.role}`],
    messageExamples: [[{ user: 'operatore', content: { text: 'Fammi una proposta adatta a questo cliente' } }, { user: persona.name, content: { text: 'Ti preparo una proposta coerente con profilo, obiettivi e policy.' } }]],
  };
}
