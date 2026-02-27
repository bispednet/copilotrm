import assistance from './assistance-agent.persona.json';
import preventivi from './preventivi-agent.persona.json';
import telephony from './telephony-agent.persona.json';
import customerCare from './customer-care-agent.persona.json';
import content from './content-agent.persona.json';
import compliance from './compliance-agent.persona.json';

export const personas = {
  assistance,
  preventivi,
  telephony,
  customerCare,
  content,
  compliance,
};

export type PersonaKey = keyof typeof personas;
