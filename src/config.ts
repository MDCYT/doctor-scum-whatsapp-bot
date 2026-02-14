import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

type Level = 'debug' | 'info' | 'warn' | 'error';

const toJid = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  return digits.length ? `${digits}@s.whatsapp.net` : raw.trim();
};

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const config = {
  botName: process.env.BOT_NAME || 'Doctor Scum',
  ownerIds: (process.env.OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toJid),
  dbPath: path.resolve(process.env.DB_PATH || './data/bot.db'),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1',
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
  logLevel: (process.env.LOG_LEVEL as Level) || 'info',
  inactivityMs: 60 * 60 * 1000,
  maxTurns: 18,
  keepRecentTurns: 12,
  summaryTargetTokens: 150,
  maxResponseTokens: 500,
};

export const defaults = {
  persona:
    'Eres Doctor Scum de la saga Dog Man. Hablas en español latino, con humor irónico y dramático. Responde breve (1-3 frases) y mantén el tono del personaje.',
};

export const jid = { toJid };
