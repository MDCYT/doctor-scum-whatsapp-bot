import { db } from './db';
import { config, jid as jidUtil } from './config';

export const COMMAND_PREFIX = 'ds.';

export type CommandContext = {
  chatId: string;
  senderId: string;
  isGroup: boolean;
  isOwner: boolean;
  reply: (text: string) => Promise<void>;
  sock?: any;
};

export type CommandHandler = (ctx: CommandContext, args: string[]) => Promise<void>;

const display = (id: string) => id.replace('@s.whatsapp.net', '').replace('@g.us', '');

const requireOwner = async (ctx: CommandContext) => {
  if (!ctx.isOwner) {
    await ctx.reply('Este comando es solo para los dueños.');
    return false;
  }
  return true;
};

const handlers: Record<string, CommandHandler> = {
  setup: async (ctx, args) => {
    const msg = args.join(' ').trim();
    if (!msg) {
      await ctx.reply('Usa: ds.setup @bot (etiqueta al bot)');
      return;
    }
    
    // Extrae solo el número (sin dominio) para comparar menciones
    let botNumber = '';
    
    if (msg.startsWith('@')) {
      botNumber = msg.substring(1).replace(/@.*/, '');
    } else if (/^\d+$/.test(msg)) {
      botNumber = msg;
    } else {
      // Si es un JID completo, extrae el número
      botNumber = msg.replace(/@.*/, '');
    }
    
    if (!/^\d+$/.test(botNumber)) {
      await ctx.reply('❌ Número inválido. Usa: ds.setup @bot o ds.setup <numero>');
      return;
    }
    
    db.setBotJid(ctx.chatId, botNumber);
    await ctx.reply(`✅ JID del bot guardado: ${botNumber}\nAhora detectaré menciones correctamente (funciona con @s.whatsapp.net y @lid).`);
  },

  yo: async (ctx) => {
    await ctx.reply(`Tu JID: ${ctx.senderId}`);
  },

  'link-numero': async (ctx, args) => {
    const target = args.join(' ').trim();
    if (!target) {
      await ctx.reply('Usa: ds.link-numero <jid o numero a vincular>');
      return;
    }
    const linkedJid = target.includes('@') ? target : jidUtil.toJid(target);
    db.linkNumber(ctx.senderId, linkedJid);
    await ctx.reply(`Números vinculados: ${display(ctx.senderId)} ↔️ ${display(linkedJid)}\nAhora ambos números tendrán los mismos permisos.`);
  },

  ayuda: async (ctx) => {
    await ctx.reply(
      'Comandos (prefijo ds.):\n' +
        '- ds.setup (ejecuta en cada grupo/DM nuevo)\n' +
        '- ds.yo\n' +
        '- ds.ayuda | ds.h\n' +
        '- ds.estado | ds.s\n' +
        '- ds.link-numero <jid> (vincula tus números)\n' +
        '- ds.persona <texto> (dueños)\n' +
        '- ds.temp <0-1> (dueños)\n' +
        '- ds.autorizar <jid o numero> (dueños)\n' +
        '- ds.desautorizar <jid o numero> (dueños)\n' +
        '- ds.autorizar-grupo [aqui|jid] (dueños)\n' +
        '- ds.desautorizar-grupo [aqui|jid] (dueños)\n' +
        '- ds.listar\n' +
        '- ds.nueva-sesion <nombre>\n' +
        '- ds.usar-sesion <nombre>\n' +
        '- ds.cerrar-sesion\n' +
        '- ds.listar-sesiones\n' +
        '- ds.reset'
    );
  },

  h: async (ctx, args) => handlers.ayuda(ctx, args),

  estado: async (ctx) => {
    const persona = db.getConfig('persona') || 'sin definir';
    const temp = db.getConfig('temperature') || String(config.temperature);
    const active = db.getActiveSession(ctx.chatId);
    await ctx.reply(
      `Estado:\nPersona: ${persona.slice(0, 80)}...\nTemp: ${temp}\nSesión activa: ${active ? active.name : 'ninguna'}`
    );
  },

  s: async (ctx, args) => handlers.estado(ctx, args),

  persona: async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    const text = args.join(' ').trim();
    if (!text) {
      await ctx.reply('Usa: ds.persona <nuevo texto>');
      return;
    }
    db.setConfig('persona', text);
    await ctx.reply('Persona actualizada.');
  },

  temp: async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    const val = parseFloat(args[0]);
    if (Number.isNaN(val) || val < 0 || val > 1) {
      await ctx.reply('Usa: ds.temp <numero entre 0 y 1>');
      return;
    }
    db.setConfig('temperature', String(val));
    await ctx.reply(`Temperatura guardada: ${val}`);
  },

  autorizar: async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    const raw = args.join(' ').trim();
    if (!raw) {
      await ctx.reply('Usa: ds.autorizar <jid o numero>\nObtén tu JID con: ds.yo');
      return;
    }
    const jid = raw.includes('@') ? raw : jidUtil.toJid(raw);
    db.authorizeUser(jid);
    await ctx.reply(`Autorizado ${display(jid)}`);
  },

  desautorizar: async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    const raw = args.join(' ').trim();
    if (!raw) {
      await ctx.reply('Usa: ds.desautorizar <jid o numero>');
      return;
    }
    const jid = raw.includes('@') ? raw : jidUtil.toJid(raw);
    db.deauthorizeUser(jid);
    await ctx.reply(`Desautorizado ${display(jid)}`);
  },

  'autorizar-grupo': async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    let target = args.join(' ').trim();
    if (!target && ctx.isGroup) target = 'aqui';
    if (!target) {
      await ctx.reply('Usa: ds.autorizar-grupo [aqui|jid]');
      return;
    }
    let gid = target;
    if (target === 'aqui') {
      gid = ctx.chatId;
    } else if (!target.includes('@')) {
      gid = `${target.replace(/\D/g, '')}@g.us`;
    }
    db.authorizeGroup(gid);
    await ctx.reply(`Grupo autorizado: ${display(gid)}`);
  },

  'desautorizar-grupo': async (ctx, args) => {
    if (!(await requireOwner(ctx))) return;
    let target = args.join(' ').trim();
    if (!target && ctx.isGroup) target = 'aqui';
    if (!target) {
      await ctx.reply('Usa: ds.desautorizar-grupo [aqui|jid]');
      return;
    }
    let gid = target;
    if (target === 'aqui') {
      gid = ctx.chatId;
    } else if (!target.includes('@')) {
      gid = `${target.replace(/\D/g, '')}@g.us`;
    }
    db.deauthorizeGroup(gid);
    await ctx.reply(`Grupo desautorizado: ${display(gid)}`);
  },

  listar: async (ctx) => {
    const users = db.listUsers();
    const groups = db.listGroups();
    await ctx.reply(
      `Autorizados:\nUsuarios: ${users.map(display).join(', ') || 'ninguno'}\nGrupos: ${
        groups.map(display).join(', ') || 'ninguno'
      }`
    );
  },

  'nueva-sesion': async (ctx, args) => {
    const name = args.join(' ').trim() || 'principal';
    db.createSession(ctx.chatId, name);
    await ctx.reply(`Sesión activa: ${name}`);
  },

  'usar-sesion': async (ctx, args) => {
    const name = args.join(' ').trim();
    if (!name) {
      await ctx.reply('Usa: ds.usar-sesion <nombre>');
      return;
    }
    const session = db.activateSession(ctx.chatId, name);
    if (!session) {
      await ctx.reply('No existe esa sesión.');
      return;
    }
    await ctx.reply(`Sesión activa: ${name}`);
  },

  'cerrar-sesion': async (ctx) => {
    const active = db.getActiveSession(ctx.chatId);
    if (!active) {
      await ctx.reply('No hay sesión activa.');
      return;
    }
    db.closeSession(active.id);
    await ctx.reply('Sesión cerrada. Usa ds.usar-sesion para reabrir.');
  },

  'listar-sesiones': async (ctx) => {
    const sessions = db.listSessions(ctx.chatId);
    if (!sessions.length) {
      await ctx.reply('No hay sesiones guardadas.');
      return;
    }
    const lines = sessions
      .map((s) => `${s.is_active ? '✅' : '⏸️'} ${s.name} (visto ${s.last_active})`)
      .join('\n');
    await ctx.reply(lines);
  },

  reset: async (ctx) => {
    const active = db.getActiveSession(ctx.chatId);
    if (!active) {
      await ctx.reply('No hay sesión activa.');
      return;
    }
    db.resetSession(active.id);
    await ctx.reply('Contexto de la sesión activo reiniciado.');
  },
};

const aliasMap: Record<string, string> = {
  setup: 'setup',
  yo: 'yo',
  h: 'ayuda',
  s: 'estado',
  persona: 'persona',
  temp: 'temp',
  link: 'link-numero',
  auth: 'autorizar',
  'auth-grupo': 'autorizar-grupo',
  'dauth': 'desautorizar',
  'dauth-grupo': 'desautorizar-grupo',
  nueva: 'nueva-sesion',
  usar: 'usar-sesion',
  cerrar: 'cerrar-sesion',
  sesiones: 'listar-sesiones',
};

export async function runCommand(ctx: CommandContext, rawCommand: string, args: string[]) {
  const key = aliasMap[rawCommand] || rawCommand;
  const handler = handlers[key];
  if (!handler) {
    await ctx.reply('Comando no reconocido. Usa ds.ayuda.');
    return;
  }
  await handler(ctx, args);
}
