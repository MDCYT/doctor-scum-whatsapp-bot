import OpenAI from 'openai';
import { config } from './config';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type HistoryItem = { role: 'user' | 'assistant'; content: string };

export async function generateReply(args: {
  persona: string;
  summary?: string | null;
  history: HistoryItem[];
  userMessage: string;
  temperature?: number;
}): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${args.persona}\n\nInstrucciones: responde siempre en español. Si te piden comandos, recuérdales usar el prefijo ds.`,
    },
  ];

  if (args.summary) {
    messages.push({ role: 'system', content: `Resumen previo del chat: ${args.summary}` });
  }

  args.history.forEach((h) => messages.push({ role: h.role, content: h.content }));
  messages.push({ role: 'user', content: args.userMessage });

  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: args.temperature ?? config.temperature,
    max_tokens: config.maxResponseTokens,
    messages,
  });

  return completion.choices[0].message.content || '...';
}

export async function summarizeMessages(text: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.3,
    max_tokens: config.summaryTargetTokens,
    messages: [
      {
        role: 'system',
        content: 'Resume el chat en español en 3-5 frases, manteniendo hechos clave y tono.',
      },
      { role: 'user', content: text },
    ],
  });
  return completion.choices[0].message.content || '';
}
