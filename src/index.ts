import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { config, jid as jidUtil } from './config';
import { db } from './db';
import { COMMAND_PREFIX, runCommand } from './commands';
import { generateReply, summarizeMessages } from './ai';

const isOwner = (jid: string) => {
    console.log(`Verificando si ${jid} es dueño...`);
  if (config.ownerIds.includes(jid)) return true;
  const linked = db.getLinkedNumbers(jid);
  return linked.some((id) => config.ownerIds.includes(id));
};

const isAuthorized = (sender: string, chatId: string, isGroup: boolean) => {

    if (isOwner(sender)) return true;
    if (isGroup) {
        if (db.isGroupAuthorized(chatId)) return true;
        return db.isUserAuthorized(sender);
    }
    return db.isUserAuthorized(sender);
};

const extractText = (msg: any): string | undefined => {
    const m = msg.message;
    if (!m) return undefined;
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    return undefined;
};

const isBotMentioned = (msg: any, botNumber: string): boolean => {
    const m = msg.message;
    if (!m) return false;
    
    const mentions = m.extendedTextMessage?.contextInfo?.mentionedJid || [];
    
    console.log(`Menciones: ${mentions.join(', ')}, buscando número: ${botNumber}`);
    
    for (const mention of mentions) {
        // Extrae el número de la mención (ignora @s.whatsapp.net o @lid)
        const mentionNumber = mention.replace(/@.*/, '');
        const parsedBotNumber = botNumber.replace(/@.*/, '');
        if (mentionNumber === parsedBotNumber) {
            console.log(`✅ Bot mencionado detectado (${mention})`);
            return true;
        }
    }
    
    return false;
};

async function handleChatMessage(sock: any, chatId: string, senderId: string, isGroup: boolean, text: string, msg: any, botJid: string) {
    const owner = isOwner(senderId);
    console.log(`Mensaje de ${jidUtil.toJid(senderId)} en ${jidUtil.toJid(chatId)}: ${text}`);
    if (text.startsWith(COMMAND_PREFIX)) {
        const without = text.slice(COMMAND_PREFIX.length).trim();
        const [rawCmd, ...rest] = without.split(/\s+/);
        const command = rawCmd?.toLowerCase();
        if (!command) return;

        const ctx = {
            chatId,
            senderId,
            isGroup,
            isOwner: owner,
            reply: async (t: string) => sock.sendMessage(chatId, { text: t }),
            sock,
        };

        if (!owner && !isAuthorized(senderId, chatId, isGroup) && command !== 'ayuda' && command !== 'h' && command !== 'yo' && command !== 'link-numero' && command !== 'link' && command !== 'setup') {
            await ctx.reply('No estás autorizado. Pide acceso a un administrador.');
            return;
        }

        await runCommand(ctx, command, rest);
        return;
    }

    if (!isAuthorized(senderId, chatId, isGroup)) {
        // En grupos, ignora silenciosamente. En DMs, avisa.
        if (!isGroup) {
            await sock.sendMessage(chatId, { text: 'No estás autorizado. Usa ds.ayuda si crees que es un error.' });
        }
        return;
    }

    if (isGroup && !isBotMentioned(msg, botJid)) {
        return;
    }

    let session = db.getActiveSession(chatId) ?? db.createSession(chatId, 'principal');

    const last = new Date(session.last_active).getTime();
    if (Date.now() - last > config.inactivityMs) {
        db.closeSession(session.id);
        await sock.sendMessage(chatId, {
            text: `La sesión '${session.name}' está inactiva (1h sin uso). Usa ds.usar-sesion ${session.name} para continuar o ds.nueva-sesion <nombre>.`,
        });
        return;
    }

    const persona = db.getConfig('persona') || config.botName;
    const temp = parseFloat(db.getConfig('temperature') || String(config.temperature));

    let messages = db.getMessages(session.id);

    if (messages.length > config.maxTurns) {
        const keep = config.keepRecentTurns;
        const oldPart = messages.slice(0, messages.length - keep);
        const oldText = oldPart.map((m) => `${m.role}: ${m.content}`).join('\n');
        const priorSummary = session.summary ? `${session.summary}\n` : '';
        const newSummary = await summarizeMessages(`${priorSummary}${oldText}`);
        db.saveSummary(session.id, newSummary);
        db.deleteOldMessages(session.id, keep);
        messages = db.getMessages(session.id);
        session.summary = newSummary;
    }

    const history = messages.slice(-config.maxTurns).map((m) => ({ role: m.role, content: m.content }));
    const reply = await generateReply({
        persona,
        summary: session.summary,
        history,
        userMessage: text,
        temperature: temp,
    });

    db.addMessage(session.id, 'user', text);
    db.addMessage(session.id, 'assistant', reply);

    await sock.sendMessage(chatId, { text: reply });
}

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
    });

    let botJid = '';

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            botJid = sock.user?.id || '';
            console.log(`✅ Bot conectado. JID: ${botJid}`);
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            const chatId = msg.key.remoteJid as string;
            const isGroup = chatId.endsWith('@g.us');
            const senderId = isGroup ? (msg.key.participant as string) : chatId;
            const text = extractText(msg);
            if (!text) continue;
            try {
                const botJid = db.getBotJid(chatId) || '';
                await handleChatMessage(sock, chatId, senderId, isGroup, text.trim(), msg, botJid);
            } catch (err) {
                console.error('Error manejando mensaje', err);
                await sock.sendMessage(chatId, { text: 'Ocurrió un error. Intenta de nuevo.' });
            }
        }
    });
}

start().catch((err) => {
    console.error('No se pudo iniciar el bot', err);
    process.exit(1);
});
