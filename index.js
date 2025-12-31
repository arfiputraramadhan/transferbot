require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ===================== KONFIGURASI =====================
// Cek environment variables
const requiredVars = ['BOT_TOKEN', 'OWNER_ID', 'API_KEY'];
const missingVars = requiredVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error('❌ ERROR: Environment variables missing:', missingVars);
    console.error('Buat file .env dengan variabel berikut:');
    console.error('BOT_TOKEN=your_bot_token');
    console.error('OWNER_ID=your_telegram_id');
    console.error('API_KEY=your_atlantic_api_key');
    process.exit(1);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL || 'https://atlantich2h.com';
const MIN_TRANSFER = parseInt(process.env.MIN_TRANSFER) || 1000;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Optional for production

console.log('====================================');
console.log('🤖 ATLANTIC TRANSFER BOT (Webhook)');
console.log('====================================');
console.log('✅ Config loaded successfully');
console.log(`👤 Owner ID: ${OWNER_ID}`);
console.log(`🔗 API URL: ${API_URL}`);
console.log(`💰 Min Transfer: Rp ${MIN_TRANSFER.toLocaleString()}`);
console.log(`🚪 Port: ${PORT}`);
console.log('====================================');

// ===================== INISIALISASI BOT =====================
let bot;
try {
    // Gunakan webhook jika ada URL, jika tidak gunakan polling dengan interval lebih lama
    if (WEBHOOK_URL) {
        console.log('🌐 Using webhook mode');
        bot = new TelegramBot(BOT_TOKEN);
        
        // Setup express untuk webhook
        const app = express();
        app.use(express.json());
        
        app.post(`/bot${BOT_TOKEN}`, (req, res) => {
            bot.processUpdate(req.body);
            res.sendStatus(200);
        });
        
        app.listen(PORT, () => {
            console.log(`✅ Webhook server listening on port ${PORT}`);
            
            // Set webhook
            bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`)
                .then(() => console.log('✅ Webhook set successfully'))
                .catch(err => console.error('❌ Failed to set webhook:', err.message));
        });
    } else {
        console.log('📡 Using polling mode (slower interval)');
        bot = new TelegramBot(BOT_TOKEN, {
            polling: {
                interval: 1000, // Interval lebih lama
                autoStart: true,
                params: {
                    timeout: 60,
                    limit: 1
                }
            }
        });
    }
} catch (error) {
    console.error('❌ Failed to initialize bot:', error.message);
    process.exit(1);
}

// ===================== ERROR HANDLING =====================
if (!WEBHOOK_URL) {
    bot.on('polling_error', (error) => {
        console.error('⚠️ Polling Error:', error.code || 'UNKNOWN', error.message);
        // Tidak auto-restart, biarkan bot handle sendiri
    });
}

bot.on('error', (error) => {
    console.error('⚠️ Bot Error:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// ===================== HELPER FUNCTIONS =====================
function isOwner(userId) {
    return userId.toString() === OWNER_ID.toString();
}

function formatRupiah(amount) {
    return 'Rp ' + parseInt(amount).toLocaleString('id-ID');
}

async function apiCall(endpoint, data) {
    try {
        const formData = new URLSearchParams();
        formData.append('api_key', API_KEY);
        
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                formData.append(key, value.toString());
            }
        }
        
        console.log(`📡 API ${endpoint} called`);
        const response = await axios.post(`${API_URL}${endpoint}`, formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000 // 10 second timeout
        });
        
        return response.data;
        
    } catch (error) {
        console.error(`❌ API Error ${endpoint}:`, error.message);
        
        // Return error message based on error type
        if (error.code === 'ECONNABORTED') {
            return { status: false, message: 'Timeout: Server tidak merespons' };
        } else if (error.code === 'ECONNREFUSED') {
            return { status: false, message: 'Tidak dapat terhubung ke server' };
        } else if (error.response) {
            return { 
                status: false, 
                message: `API Error ${error.response.status}: ${error.response.data?.message || 'Unknown'}` 
            };
        } else {
            return { status: false, message: error.message || 'Network error' };
        }
    }
}

// ===================== SIMPLE COMMAND HANDLERS =====================

// /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    console.log(`👤 User ${userId} started bot`);
    
    if (!isOwner(userId)) {
        bot.sendMessage(chatId, '❌ Bot ini hanya untuk owner!')
            .catch(err => console.error('Send message error:', err.message));
        return;
    }
    
    const message = `
🤖 *ATLANTIC TRANSFER BOT*

*Perintah:*
💸 /tf bank nomor nama jumlah
🔍 /cek bank nomor
📋 /list
📊 /status id

*Contoh:*
\`/tf ovo 62895600689900 Arfi 10000\`
\`/cek ovo 62895600689900\`

*Minimal:* ${formatRupiah(MIN_TRANSFER)}
    `;
    
    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown'
    }).catch(err => console.error('Send message error:', err.message));
});

// /tf - Transfer
bot.onText(/\/tf (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const args = match[1].match(/(\S+)/g);
        if (!args || args.length < 4) {
            bot.sendMessage(chatId, '❌ Format: /tf bank nomor nama jumlah\nContoh: /tf ovo 62895600689900 Arfi 10000');
            return;
        }
        
        const bank = args[0].toLowerCase();
        const nomor = args[1];
        const nama = args.slice(2, -1).join(' ');
        const jumlah = parseInt(args[args.length - 1].replace(/\D/g, ''));
        
        if (jumlah < MIN_TRANSFER) {
            bot.sendMessage(chatId, `❌ Minimal ${formatRupiah(MIN_TRANSFER)}`);
            return;
        }
        
        console.log(`Transfer: ${bank}, ${nomor}, ${nama}, ${jumlah}`);
        
        // Langsung transfer tanpa cek dulu (lebih cepat)
        const loadingMsg = await bot.sendMessage(chatId, '⚡ Memproses transfer...');
        
        const transferData = {
            ref_id: `TF-${Date.now()}`,
            kode_bank: bank,
            nomor_akun: nomor,
            nama_pemilik: nama,
            nominal: jumlah
        };
        
        const result = await apiCall('/transfer/create', transferData);
        
        if (result.status === true && result.data) {
            const data = result.data;
            const message = `
✅ *BERHASIL!*

🏦 Bank: ${bank.toUpperCase()}
📱 Tujuan: ${nomor}
👤 Penerima: ${nama}
💰 Jumlah: ${formatRupiah(jumlah)}
💸 Fee: ${formatRupiah(data.fee || 0)}
🆔 ID: ${data.id}

✅ Status: ${data.status}
            `;
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            bot.editMessageText(`❌ Gagal: ${result.message || 'Unknown error'}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
        
    } catch (error) {
        console.error('Transfer error:', error);
        bot.sendMessage(chatId, '❌ Error sistem');
    }
});

// /cek - Cek rekening
bot.onText(/\/cek (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const args = match[1].split(' ');
        if (args.length < 2) {
            bot.sendMessage(chatId, '❌ Format: /cek bank nomor\nContoh: /cek ovo 62895600689900');
            return;
        }
        
        const bank = args[0].toLowerCase();
        const nomor = args[1];
        
        const loadingMsg = await bot.sendMessage(chatId, '🔍 Memeriksa...');
        
        const result = await apiCall('/transfer/cek_rekening', {
            bank_code: bank,
            account_number: nomor
        });
        
        if (result.status === true && result.data) {
            const message = `
✅ *VALID*

🏦 Bank: ${bank.toUpperCase()}
📱 Nomor: ${nomor}
👤 Nama: ${result.data.nama_pemilik}
✅ Status: ${result.data.status}
            `;
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            bot.editMessageText(`❌ Tidak valid: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
        
    } catch (error) {
        console.error('Cek error:', error);
        bot.sendMessage(chatId, '❌ Error sistem');
    }
});

// /list - Daftar bank
bot.onText(/\/(list|daftar)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const loadingMsg = await bot.sendMessage(chatId, '📋 Mengambil daftar...');
        
        const result = await apiCall('/transfer/bank_list', {});
        
        if (result.status === true && result.data) {
            let message = '🏦 *DAFTAR BANK*\n\n';
            
            // Ambil 10 bank pertama saja
            result.data.slice(0, 10).forEach(bank => {
                message += `• ${bank.bank_name} (\`${bank.bank_code}\`)\n`;
            });
            
            if (result.data.length > 10) {
                message += `\n...dan ${result.data.length - 10} lainnya`;
            }
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            bot.editMessageText('❌ Gagal mengambil daftar', {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
        
    } catch (error) {
        console.error('List error:', error);
        bot.sendMessage(chatId, '❌ Error sistem');
    }
});

// /status - Cek status
bot.onText(/\/status(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const id = match[1];
        if (!id) {
            bot.sendMessage(chatId, '❌ Format: /status id_transaksi\nContoh: /status TRF-123456');
            return;
        }
        
        const loadingMsg = await bot.sendMessage(chatId, '📊 Mengecek...');
        
        const result = await apiCall('/transfer/status', { id: id });
        
        if (result.status === true && result.data) {
            const data = result.data;
            const message = `
📊 *STATUS*

🆔 ID: ${data.id}
👤 Nama: ${data.name}
📱 Tujuan: ${data.nomor_tujuan}
💰 Jumlah: ${formatRupiah(data.nominal)}
✅ Status: ${data.status}
⏱️ Waktu: ${data.created_at}
            `;
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            bot.editMessageText(`❌ Tidak ditemukan: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
        
    } catch (error) {
        console.error('Status error:', error);
        bot.sendMessage(chatId, '❌ Error sistem');
    }
});

// ===================== STARTUP =====================
console.log('🚀 Bot started successfully');

// Test API connection
setTimeout(async () => {
    console.log('🔍 Testing API connection...');
    
    try {
        const result = await apiCall('/transfer/bank_list', {});
        
        if (result.status === true) {
            console.log(`✅ API Connected! ${result.data?.length || 0} banks available`);
            
            // Send startup message
            try {
                await bot.sendMessage(OWNER_ID, 
                    `✅ Bot aktif!\nMinimal transfer: ${formatRupiah(MIN_TRANSFER)}\nKetik /start`
                );
            } catch (err) {
                console.log('⚠️ Cannot send startup message');
            }
        } else {
            console.log('⚠️ API Warning:', result.message);
        }
    } catch (error) {
        console.log('⚠️ API Test error:', error.message);
    }
    
    console.log('🤖 Bot ready!');
}, 2000);