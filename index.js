const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = 'GANTI_TOKEN_DISINI';
const ADMIN_ID = 123456789;
const GROUP_ID = -1001234567890;
const BANNER_URL = 'https://telegra.ph/file/8b3877c449c2567936761.jpg';

const bot = new TelegramBot(TOKEN, { polling: true });
const DB_FILE = 'database.json';
const userState = {};

const loadData = () => {
    if (!fs.existsSync(DB_FILE)) return { files: [], users: [] };
    return JSON.parse(fs.readFileSync(DB_FILE));
};

const saveData = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

const registerUser = (chatId) => {
    const data = loadData();
    if (!data.users.includes(chatId)) {
        data.users.push(chatId);
        saveData(data);
    }
};

const getMainMenu = (db) => {
    return {
        caption: `
🤖 *TXT CLOUD DASHBOARD*
━━━━━━━━━━━━━━━━━━━━
👋 *Selamat Datang*
Sistem penyimpanan file teks berbasis cloud.

📊 *Database Status:*
📂 Total File: \`${db.files.length}\`
👤 Total User: \`${db.users.length}\`

💡 *Panduan:*
Langsung kirim file *.txt* ke sini untuk menyimpan.

👇 *Navigasi:*
`,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📂 Galeri File', callback_data: 'gallery' }],
                [{ text: '🔄 Refresh', callback_data: 'refresh' }]
            ]
        }
    };
};

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    registerUser(chatId);
    
    if (userState[chatId]) delete userState[chatId];

    const param = match[1];

    if (param && param.startsWith('dl_')) {
        const fileId = param.split('_')[1];
        const db = loadData();
        const file = db.files.find(f => f.id === fileId);

        if (file) {
            await bot.sendMessage(chatId, `⏳ *Sedang mengambil file...*`, { parse_mode: 'Markdown' });
            await bot.sendDocument(chatId, file.file_id, { caption: `✅ *${file.name}*` });
        } else {
            bot.sendMessage(chatId, '❌ *File tidak ditemukan.*', { parse_mode: 'Markdown' });
        }
        return;
    }

    const db = loadData();
    const menu = getMainMenu(db);
    bot.sendPhoto(chatId, BANNER_URL, menu);
});

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const doc = msg.document;

    if (!doc.file_name.endsWith('.txt') && doc.mime_type !== 'text/plain') {
        const sent = await bot.sendMessage(chatId, '⚠️ *Format Ditolak!* Hanya menerima file .txt', { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 3000);
        return;
    }

    userState[chatId] = { step: 'NAMING', fileId: doc.file_id };

    const text = `
📝 *FILE DITERIMA*
━━━━━━━━━━━━━━━━━━━━
File: \`${doc.file_name}\`

✍️ *Balas pesan ini dengan NAMA file.*
`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Batal', callback_data: 'cancel_upload' }]]
        }
    });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return;
    if (!userState[chatId]) return;

    if (userState[chatId].step === 'NAMING') {
        if (!msg.text) return;

        const name = msg.text;
        const fileId = userState[chatId].fileId;
        const db = loadData();

        const newFile = {
            id: Date.now().toString(36),
            name: name,
            date: new Date().toLocaleDateString(),
            file_id: fileId,
            uploader: msg.from.first_name
        };

        db.files.push(newFile);
        saveData(db);
        delete userState[chatId];

        const successText = `
✅ *BERHASIL DISIMPAN!*
━━━━━━━━━━━━━━━━━━━━
📂 Nama: *${name}*
🆔 ID: \`${newFile.id}\`
        `;
        
        await bot.sendMessage(chatId, successText, { parse_mode: 'Markdown' });

        if (GROUP_ID) {
            const me = await bot.getMe();
            const deepLink = `https://t.me/${me.username}?start=dl_${newFile.id}`;
            const groupMsg = `
🔔 *FILE UPDATE*
━━━━━━━━━━━━━━━━━━━━
📂 *Judul:* ${name}
👤 *Oleh:* ${msg.from.first_name}

👇 *Klik tombol untuk unduh:*
            `;
            
            bot.sendMessage(GROUP_ID, groupMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '📥 DOWNLOAD .TXT', url: deepLink }]]
                }
            }).catch(() => {});
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;

    if (data === 'cancel_upload') {
        delete userState[chatId];
        bot.deleteMessage(chatId, msgId);
        bot.sendMessage(chatId, '🚫 Upload dibatalkan.');
    }

    else if (data === 'gallery') {
        const db = loadData();
        if (db.files.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: 'Database kosong!', show_alert: true });
        }

        const buttons = db.files.map((f) => {
            return [{ text: `📄 ${f.name}`, callback_data: `get_${f.id}` }];
        });
        
        buttons.push([{ text: '🔙 Kembali', callback_data: 'main_menu' }]);

        bot.editMessageCaption('📂 *GALERI FILE TXT*\nPilih file di bawah ini:', {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        }).catch(() => {}); 
    }

    else if (data === 'refresh' || data === 'main_menu') {
        const db = loadData();
        const menu = getMainMenu(db);
        bot.editMessageCaption(menu.caption, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: menu.reply_markup
        }).catch(() => {});
    }

    else if (data.startsWith('get_')) {
        const id = data.split('_')[1];
        const db = loadData();
        const file = db.files.find(f => f.id === id);

        if (file) {
            bot.sendMessage(chatId, `🚀 *Mengirim file...*\n📄 ${file.name}`, { parse_mode: 'Markdown' });
            bot.sendDocument(chatId, file.file_id);
        }
    }
});

bot.onText(/\/bc (.+)/, async (msg, match) => {
    if (msg.chat.id !== ADMIN_ID) return;
    const text = match[1];
    const db = loadData();
    let sent = 0;

    bot.sendMessage(msg.chat.id, '⏳ *Sending broadcast...*', { parse_mode: 'Markdown' });

    for (const uid of db.users) {
        try {
            await bot.sendMessage(uid, `📢 *PENGUMUMAN*\n━━━━━━━━━━━━━━━━━━━━\n${text}`, { parse_mode: 'Markdown' });
            sent++;
        } catch (e) {}
    }
    bot.sendMessage(msg.chat.id, `✅ Terkirim ke ${sent} user.`);
});

console.log('BOT IS RUNNING...');
