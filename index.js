require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');

const adminId = parseInt(process.env.ADMIN_ID);
const bot = new Telegraf(process.env.BOT_TOKEN);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let state = {
    step: 'IDLE',
    data: {},
    isRunning: false,
    stopSignal: false
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id !== adminId) {
        await ctx.reply('⛔ <b>ACCESS DENIED</b>\nDon\'t touch this bot.', { parse_mode: 'HTML' });
        return;
    }
    return next();
});

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🚀 CREATE GROUPS', 'cmd_create')],
    [Markup.button.callback('🛑 EMERGENCY STOP', 'cmd_stop'), Markup.button.callback('📡 STATUS', 'cmd_status')],
    [Markup.button.callback('♻️ RESET', 'cmd_reset')]
]);

bot.start((ctx) => {
    state.step = 'IDLE';
    ctx.reply('🤖 <b>COMMAND CENTER</b>\nSystem Ready.', { parse_mode: 'HTML', ...mainMenu });
});

bot.action('cmd_reset', (ctx) => {
    state = { step: 'IDLE', data: {}, isRunning: false, stopSignal: false };
    ctx.reply('🔄 System Reset.', mainMenu);
});

bot.action('cmd_status', (ctx) => {
    const status = client.info ? '✅ CONNECTED' : '❌ DISCONNECTED';
    ctx.reply(`📡 <b>SYSTEM STATUS</b>\nWhatsApp: ${status}`, { parse_mode: 'HTML' });
});

bot.action('cmd_stop', (ctx) => {
    if (!state.isRunning) return ctx.reply('⚠️ No active process.');
    state.stopSignal = true;
    ctx.reply('🛑 <b>STOPPING...</b>\nWaiting for current task to finish.', { parse_mode: 'HTML' });
});

bot.action('cmd_create', (ctx) => {
    if (!client.info) return ctx.reply('⚠️ WhatsApp not connected.');
    if (state.isRunning) return ctx.reply('⚠️ Process already running.');

    state.step = 'INPUT_NAME';
    ctx.reply('1️⃣ Enter <b>GROUP NAME</b>:', { parse_mode: 'HTML' });
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;

    if (state.step === 'INPUT_NAME') {
        state.data.name = text;
        state.step = 'INPUT_NUMBERS';
        return ctx.reply('2️⃣ Enter <b>PHONE NUMBERS</b> (Space separated):\nEx: 628123 628567', { parse_mode: 'HTML' });
    }

    if (state.step === 'INPUT_NUMBERS') {
        const raw = text.split(' ');
        const participants = raw.map(num => `${num.replace(/\D/g, '')}@c.us`);
        
        if (participants.length === 0) return ctx.reply('⚠️ Invalid numbers. Try again.');
        
        state.data.participants = participants;
        state.step = 'INPUT_COUNT';
        return ctx.reply('3️⃣ Enter <b>TOTAL GROUPS</b> (1-10):', { parse_mode: 'HTML' });
    }

    if (state.step === 'INPUT_COUNT') {
        let count = parseInt(text);
        if (isNaN(count) || count < 1) count = 1;
        if (count > 10) count = 10;

        state.data.count = count;
        state.step = 'IDLE';

        const summary = `
📝 <b>TASK SUMMARY</b>
Name: ${state.data.name} #(1-${count})
Targets: ${state.data.participants.length} users
Total: ${count} Groups
        `;

        return ctx.reply(summary, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ EXECUTE', 'cmd_execute')],
                [Markup.button.callback('❌ CANCEL', 'cmd_reset')]
            ])
        });
    }
});

bot.action('cmd_execute', async (ctx) => {
    state.isRunning = true;
    state.stopSignal = false;
    const { name, participants, count } = state.data;

    await ctx.reply('⚙️ <b>PROCESSING STARTED</b>', { parse_mode: 'HTML' });

    for (let i = 1; i <= count; i++) {
        if (state.stopSignal) {
            await ctx.reply('🛑 Process Terminated by User.');
            break;
        }

        const groupName = `${name} #${i}`;
        
        try {
            await ctx.telegram.editMessageText(ctx.chat.id, undefined, undefined, `⏳ Creating ${i}/${count}: <b>${groupName}</b>`, { parse_mode: 'HTML' });
            
            const res = await client.createGroup(groupName, participants);
            
            if (i < count) await sleep(5000);

        } catch (err) {
            await ctx.reply(`❌ Failed ${groupName}: ${err.message}`);
        }
    }

    state.isRunning = false;
    state.data = {};
    await ctx.reply('✅ <b>TASK COMPLETED</b>', { parse_mode: 'HTML', ...mainMenu });
});

client.on('qr', async (qr) => {
    try {
        const buffer = await QRCode.toBuffer(qr);
        await bot.telegram.sendPhoto(adminId, { source: buffer }, { caption: '📱 <b>SCAN REQUIRED</b>', parse_mode: 'HTML' });
    } catch (e) {}
});

client.on('ready', () => {
    bot.telegram.sendMessage(adminId, '✅ <b>WHATSAPP CONNECTED</b>', { parse_mode: 'HTML' });
});

bot.launch();
client.initialize();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
