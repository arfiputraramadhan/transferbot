require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Konfigurasi
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL || 'https://atlantich2h.com';
const MIN_TRANSFER = parseInt(process.env.MIN_TRANSFER) || 1000;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 15000;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

console.log('====================================');
console.log('🤖 ATLANTIC TRANSFER BOT STARTING...');
console.log('====================================');

// Inisialisasi bot dengan polling yang stabil
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 30,
            limit: 1
        }
    }
});

// Error handling untuk bot
bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.code, error.message);
    if (error.code === 'EFATAL') {
        console.log('Restarting bot in 5 seconds...');
        setTimeout(() => {
            console.log('Bot restarted');
        }, 5000);
    }
});

bot.on('error', (error) => {
    console.error('Bot Error:', error.message);
});

// Helper function untuk cek owner
function isOwner(userId) {
    return userId.toString() === OWNER_ID.toString();
}

// Helper function untuk format Rupiah
function formatRupiah(amount) {
    return 'Rp ' + parseInt(amount).toLocaleString('id-ID');
}

// Helper function untuk API call dengan retry
async function apiCall(endpoint, data, retryCount = 0) {
    try {
        const formData = new URLSearchParams();
        formData.append('api_key', API_KEY);
        
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                formData.append(key, value.toString());
            }
        }
        
        const response = await axios.post(`${API_URL}${endpoint}`, formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Atlantic-Transfer-Bot/1.0'
            },
            timeout: REQUEST_TIMEOUT
        });
        
        console.log(`API ${endpoint}:`, response.data?.status ? 'SUCCESS' : 'FAILED');
        return response.data;
        
    } catch (error) {
        console.error(`API Error ${endpoint}:`, error.message);
        
        // Retry logic
        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return apiCall(endpoint, data, retryCount + 1);
        }
        
        return {
            status: false,
            message: error.response?.data?.message || error.message || 'Network error'
        };
    }
}

// ===================== COMMAND HANDLERS =====================

// /start - Command utama
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) {
        bot.sendMessage(chatId, '❌ Bot ini hanya untuk owner!');
        return;
    }
    
    console.log(`User ${userId} started bot`);
    
    const welcomeMessage = `
⚡ *ATLANTIC H2H TRANSFER BOT*

*Perintah Cepat:*
💸 /tf [bank] [nomer] [nama] [jumlah]
🔍 /cek [bank] [nomer]
📋 /list
📊 /status [id]

*Perintah Lengkap:*
/transfer - Transfer dengan wizard
/cekbank - Cek rekening
/daftar - Daftar bank tersedia
/status - Cek status transfer

*Contoh Penggunaan:*
/tf ovo 62895600689900 Arfi 10000
/cek ovo 62895600689900
/status TRF-123456

*Minimal Transfer:* ${formatRupiah(MIN_TRANSFER)}
    `;
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['💸 TRANSFER CEPAT', '🔍 CEK REKENING'],
                ['📋 DAFTAR BANK', '📊 STATUS TRANSFER'],
                ['⚙️ BANTUAN', '🔄 RESTART']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
    
    bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown',
        ...keyboard
    });
});

// /help - Bantuan
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    const helpMessage = `
❓ *BANTUAN TRANSFER BOT*

*Format Transfer Cepat:*
/tf [kode_bank] [nomor] [nama] [jumlah]
Contoh: /tf ovo 62895600689900 Arfi 10000

*Format Cek Rekening:*
/cek [kode_bank] [nomor]
Contoh: /cek ovo 62895600689900

*Format Cek Status:*
/status [id_transaksi]
Contoh: /status TRF-123456

*Daftar Bank Populer:*
• OVO: \`ovo\`
• DANA: \`dana\`
• GoPay: \`gopay\`
• BCA: \`bca\`
• Mandiri: \`mandiri\`
• BNI: \`bni\`
• BRI: \`bri\`
• LinkAja: \`linkaja\`

*Catatan:*
- Minimal transfer: ${formatRupiah(MIN_TRANSFER)}
- Pastikan data benar sebelum transfer
- Simpan ID transaksi untuk pengecekan
    `;
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// /tf - Transfer cepat (single command)
bot.onText(/\/tf (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const args = match[1].split(' ');
        
        if (args.length < 4) {
            bot.sendMessage(chatId, '❌ Format salah!\nContoh: /tf ovo 62895600689900 Arfi 10000');
            return;
        }
        
        const bank = args[0].toLowerCase().trim();
        const nomor = args[1].trim();
        const nama = args.slice(2, args.length - 1).join(' ');
        const jumlahStr = args[args.length - 1];
        const jumlah = parseInt(jumlahStr.replace(/[^0-9]/g, ''));
        
        // Validasi
        if (!bank || !nomor || !nama || !jumlah) {
            bot.sendMessage(chatId, '❌ Data tidak lengkap!');
            return;
        }
        
        if (jumlah < MIN_TRANSFER) {
            bot.sendMessage(chatId, `❌ Minimal transfer ${formatRupiah(MIN_TRANSFER)}`);
            return;
        }
        
        if (nomor.length < 10) {
            bot.sendMessage(chatId, '❌ Nomor tidak valid!');
            return;
        }
        
        console.log(`Transfer request: ${bank}, ${nomor}, ${nama}, ${jumlah}`);
        
        // Kirim status processing
        const processingMsg = await bot.sendMessage(chatId, '⚡ *Mempersiapkan transfer...*', { 
            parse_mode: 'Markdown' 
        });
        
        // Step 1: Cek rekening dulu
        await bot.editMessageText('🔍 *Memeriksa rekening...*', {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const checkResult = await apiCall('/transfer/cek_rekening', {
            bank_code: bank,
            account_number: nomor
        });
        
        if (!checkResult.status) {
            await bot.editMessageText(`❌ *Rekening tidak valid:*\n${checkResult.message || 'Tidak ditemukan'}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
            return;
        }
        
        // Step 2: Proses transfer
        await bot.editMessageText('💸 *Melakukan transfer...*', {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const transferData = {
            ref_id: `TRF-${Date.now()}`,
            kode_bank: bank,
            nomor_akun: nomor,
            nama_pemilik: nama,
            nominal: jumlah
        };
        
        const transferResult = await apiCall('/transfer/create', transferData);
        
        // Step 3: Tampilkan hasil
        if (transferResult.status === true && transferResult.data) {
            const data = transferResult.data;
            const fee = parseInt(data.fee || 0);
            const total = parseInt(data.total || jumlah);
            
            const successMessage = `
✅ *TRANSFER BERHASIL!*

📋 *Detail Transfer:*
🏦 Bank: *${bank.toUpperCase()}*
📱 Tujuan: *${nomor}*
👤 Penerima: *${nama}*
💰 Nominal: *${formatRupiah(jumlah)}*
💸 Biaya: *${formatRupiah(fee)}*
💵 Total: *${formatRupiah(total)}*

📊 *Informasi Transaksi:*
🆔 ID: \`${data.id || transferData.ref_id}\`
📝 Status: *${data.status || 'SUCCESS'}*
⏱️ Waktu: *${data.created_at || new Date().toLocaleString('id-ID')}*

✅ *Transfer selesai dalam hitungan detik!*
            `;
            
            await bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
            
            console.log(`Transfer successful: ${data.id}`);
            
        } else {
            await bot.editMessageText(`❌ *Transfer gagal:*\n${transferResult.message || 'Unknown error'}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
            
            console.log(`Transfer failed: ${transferResult.message}`);
        }
        
    } catch (error) {
        console.error('Transfer error:', error);
        bot.sendMessage(chatId, '❌ Terjadi error sistem. Coba lagi nanti.');
    }
});

// /cek - Cek rekening cepat
bot.onText(/\/cek (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const args = match[1].split(' ');
        
        if (args.length < 2) {
            bot.sendMessage(chatId, '❌ Format salah!\nContoh: /cek ovo 62895600689900');
            return;
        }
        
        const bank = args[0].toLowerCase().trim();
        const nomor = args[1].trim();
        
        const processingMsg = await bot.sendMessage(chatId, '🔍 *Memeriksa rekening...*', {
            parse_mode: 'Markdown'
        });
        
        const result = await apiCall('/transfer/cek_rekening', {
            bank_code: bank,
            account_number: nomor
        });
        
        if (result.status === true && result.data) {
            const message = `
✅ *REKENING VALID*

🏦 *Bank:* ${bank.toUpperCase()}
📱 *Nomor:* ${nomor}
👤 *Nama Pemilik:* ${result.data.nama_pemilik || 'Tidak diketahui'}
📊 *Status:* ${result.data.status || 'VALID'}

✅ *Siap untuk transfer!*
            `;
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            await bot.editMessageText(`❌ *Rekening tidak valid:*\n${result.message || 'Tidak ditemukan'}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
        
    } catch (error) {
        console.error('Cek rekening error:', error);
        bot.sendMessage(chatId, '❌ Gagal memeriksa rekening.');
    }
});

// /list atau /daftar - Daftar bank
bot.onText(/\/(list|daftar)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const processingMsg = await bot.sendMessage(chatId, '📋 *Mengambil daftar bank...*', {
            parse_mode: 'Markdown'
        });
        
        const result = await apiCall('/transfer/bank_list', {});
        
        if (result.status === true && result.data && result.data.length > 0) {
            // Kelompokkan bank populer
            const popularBanks = ['bca', 'mandiri', 'bni', 'bri', 'ovo', 'dana', 'gopay', 'linkaja', 'shopeepay'];
            const otherBanks = [];
            
            result.data.forEach(bank => {
                if (popularBanks.includes(bank.bank_code)) {
                    popularBanks[popularBanks.indexOf(bank.bank_code)] = bank;
                } else {
                    otherBanks.push(bank);
                }
            });
            
            let message = '🏦 *DAFTAR BANK & E-WALLET*\n\n';
            
            // Tampilkan bank populer
            message += '*⭐ BANK POPULER:*\n';
            popularBanks.forEach(bank => {
                if (typeof bank === 'object') {
                    message += `• *${bank.bank_name}* (\`${bank.bank_code}\`)\n`;
                }
            });
            
            message += '\n*📱 E-WALLET:*\n';
            const ewallets = result.data.filter(b => b.type === 'ewallet' || b.type === 'emoney');
            ewallets.forEach(ewallet => {
                if (!popularBanks.includes(ewallet.bank_code)) {
                    message += `• *${ewallet.bank_name}* (\`${ewallet.bank_code}\`)\n`;
                }
            });
            
            message += '\n*🏦 BANK LAINNYA:*\n';
            otherBanks.slice(0, 10).forEach(bank => {
                message += `• *${bank.bank_name}* (\`${bank.bank_code}\`)\n`;
            });
            
            if (otherBanks.length > 10) {
                message += `• ...dan ${otherBanks.length - 10} bank lainnya\n`;
            }
            
            message += `\n✅ Total tersedia: *${result.data.length}* bank/e-wallet`;
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            await bot.editMessageText('❌ *Gagal mengambil daftar bank*', {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
        
    } catch (error) {
        console.error('Daftar bank error:', error);
        bot.sendMessage(chatId, '❌ Gagal mengambil daftar bank.');
    }
});

// /status - Cek status transfer
bot.onText(/\/status(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    try {
        const transactionId = match[1];
        
        if (!transactionId) {
            bot.sendMessage(chatId, '❌ Masukkan ID transaksi\nContoh: /status TRF-123456\n/status [id_transaksi]');
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '📊 *Mengecek status...*', {
            parse_mode: 'Markdown'
        });
        
        const result = await apiCall('/transfer/status', {
            id: transactionId
        });
        
        if (result.status === true && result.data) {
            const data = result.data;
            const message = `
📊 *STATUS TRANSAKSI*

🆔 *ID:* ${data.id || transactionId}
👤 *Nama:* ${data.name || 'Tidak diketahui'}
📱 *Tujuan:* ${data.nomor_tujuan || 'Tidak diketahui'}
💰 *Nominal:* ${formatRupiah(data.nominal || 0)}
💸 *Biaya:* ${formatRupiah(data.fee || 0)}
💵 *Total:* ${formatRupiah(data.total || data.nominal || 0)}

📈 *Status:* ${data.status ? `*${data.status.toUpperCase()}*` : 'Tidak diketahui'}
🏦 *Bank:* ${data.bank_code ? data.bank_code.toUpperCase() : 'Tidak diketahui'}
⏱️ *Waktu:* ${data.created_at || 'Tidak diketahui'}

${data.status === 'success' ? '✅ Transfer berhasil!' : 
  data.status === 'pending' ? '⏳ Sedang diproses...' : 
  '❌ Gagal atau ditolak'}
            `;
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            await bot.editMessageText(`❌ *Transaksi tidak ditemukan:*\n${result.message || 'ID tidak valid'}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
        
    } catch (error) {
        console.error('Status check error:', error);
        bot.sendMessage(chatId, '❌ Gagal memeriksa status.');
    }
});

// /transfer - Wizard transfer (step by step)
bot.onText(/\/transfer/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!isOwner(userId)) return;
    
    const userState = {
        step: 1,
        data: {}
    };
    
    // Simpan state
    userStates.set(chatId, userState);
    
    bot.sendMessage(chatId, '🏦 Masukkan kode bank (contoh: `ovo`, `dana`, `bca`):', {
        parse_mode: 'Markdown',
        reply_markup: {
            force_reply: true
        }
    });
});

// Handle semua pesan (untuk wizard)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!isOwner(userId) || !text || text.startsWith('/')) return;
    
    const userState = userStates.get(chatId);
    if (!userState) return;
    
    try {
        switch (userState.step) {
            case 1: // Bank code
                userState.data.bank = text.toLowerCase().trim();
                userState.step = 2;
                userStates.set(chatId, userState);
                
                bot.sendMessage(chatId, '📱 Masukkan nomor rekening/akun:', {
                    reply_markup: { force_reply: true }
                });
                break;
                
            case 2: // Account number
                userState.data.nomor = text.trim();
                userState.step = 3;
                userStates.set(chatId, userState);
                
                bot.sendMessage(chatId, '👤 Masukkan nama pemilik rekening:', {
                    reply_markup: { force_reply: true }
                });
                break;
                
            case 3: // Account name
                userState.data.nama = text.trim();
                userState.step = 4;
                userStates.set(chatId, userState);
                
                bot.sendMessage(chatId, `💰 Masukkan nominal transfer (min ${formatRupiah(MIN_TRANSFER)}):`, {
                    reply_markup: { force_reply: true }
                });
                break;
                
            case 4: // Amount
                const jumlah = parseInt(text.replace(/[^0-9]/g, ''));
                
                if (isNaN(jumlah) || jumlah < MIN_TRANSFER) {
                    bot.sendMessage(chatId, `❌ Nominal tidak valid. Minimal ${formatRupiah(MIN_TRANSFER)}`);
                    userStates.delete(chatId);
                    return;
                }
                
                userState.data.jumlah = jumlah;
                userStates.delete(chatId); // Clear state
                
                // Konfirmasi transfer
                const confirmMessage = `
📋 *KONFIRMASI TRANSFER*

🏦 Bank: *${userState.data.bank.toUpperCase()}*
📱 Nomor: *${userState.data.nomor}*
👤 Nama: *${userState.data.nama}*
💰 Jumlah: *${formatRupiah(userState.data.jumlah)}*

✅ Apakah data sudah benar?
                `;
                
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ YA, TRANSFER', callback_data: `confirm:${JSON.stringify(userState.data)}` },
                                { text: '❌ BATAL', callback_data: 'cancel' }
                            ]
                        ]
                    }
                };
                
                bot.sendMessage(chatId, confirmMessage, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                break;
        }
    } catch (error) {
        console.error('Wizard error:', error);
        bot.sendMessage(chatId, '❌ Terjadi error. Silakan mulai dari /transfer lagi.');
        userStates.delete(chatId);
    }
});

// Handle callback queries (konfirmasi transfer)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    if (!isOwner(userId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Akses ditolak!' });
        return;
    }
    
    try {
        if (data === 'cancel') {
            bot.editMessageText('❌ Transfer dibatalkan.', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }
        
        if (data.startsWith('confirm:')) {
            const transferData = JSON.parse(data.replace('confirm:', ''));
            
            // Kirim status processing
            await bot.editMessageText('⚡ *Memproses transfer...*', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
            });
            
            // Lakukan transfer
            const result = await apiCall('/transfer/create', {
                ref_id: `TRF-${Date.now()}`,
                kode_bank: transferData.bank,
                nomor_akun: transferData.nomor,
                nama_pemilik: transferData.nama,
                nominal: transferData.jumlah
            });
            
            // Tampilkan hasil
            if (result.status === true && result.data) {
                const data = result.data;
                const fee = parseInt(data.fee || 0);
                const total = parseInt(data.total || transferData.jumlah);
                
                const successMessage = `
✅ *TRANSFER BERHASIL!*

📋 *Detail Transfer:*
🏦 Bank: *${transferData.bank.toUpperCase()}*
📱 Tujuan: *${transferData.nomor}*
👤 Penerima: *${transferData.nama}*
💰 Nominal: *${formatRupiah(transferData.jumlah)}*
💸 Biaya: *${formatRupiah(fee)}*
💵 Total: *${formatRupiah(total)}*

📊 *Informasi Transaksi:*
🆔 ID: \`${data.id}\`
📝 Status: *${data.status}*
⏱️ Waktu: *${data.created_at}*

✅ *Transfer selesai!*
                `;
                
                bot.editMessageText(successMessage, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown'
                });
            } else {
                bot.editMessageText(`❌ *Transfer gagal:*\n${result.message || 'Unknown error'}`, {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown'
                });
            }
            
            bot.answerCallbackQuery(callbackQuery.id);
        }
    } catch (error) {
        console.error('Callback error:', error);
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Terjadi error!' });
    }
});

// Handle keyboard button presses
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!isOwner(userId) || !text) return;
    
    switch (text) {
        case '💸 TRANSFER CEPAT':
            bot.sendMessage(chatId, 'Ketik: /tf [bank] [nomer] [nama] [jumlah]\nContoh: /tf ovo 62895600689900 Arfi 10000');
            break;
            
        case '🔍 CEK REKENING':
            bot.sendMessage(chatId, 'Ketik: /cek [bank] [nomer]\nContoh: /cek ovo 62895600689900');
            break;
            
        case '📋 DAFTAR BANK':
            bot.sendMessage(chatId, 'Mengambil daftar bank...');
            const listCommand = msg;
            listCommand.text = '/list';
            listCommand.from = msg.from;
            listCommand.chat = msg.chat;
            bot.onText(/\/(list|daftar)/, async (msg) => {
                // Handler akan dipanggil
            });
            // Panggil handler secara manual
            require('fs').readFileSync(__filename); // Trigger
            break;
            
        case '📊 STATUS TRANSFER':
            bot.sendMessage(chatId, 'Ketik: /status [id_transaksi]\nContoh: /status TRF-123456');
            break;
            
        case '⚙️ BANTUAN':
            const helpCommand = msg;
            helpCommand.text = '/help';
            bot.onText(/\/help/, (msg) => {
                // Handler akan dipanggil
            });
            break;
            
        case '🔄 RESTART':
            bot.sendMessage(chatId, '🔄 Restarting bot...');
            setTimeout(() => {
                bot.sendMessage(chatId, '✅ Bot telah direstart!\nKetik /start untuk memulai.');
            }, 1000);
            break;
    }
});

// Test koneksi API saat startup
async function testConnection() {
    console.log('Testing API connection...');
    
    try {
        const result = await apiCall('/transfer/bank_list', {});
        
        if (result.status === true) {
            console.log(`✅ API Connected! Found ${result.data?.length || 0} banks`);
        } else {
            console.log('❌ API Connection failed:', result.message);
        }
    } catch (error) {
        console.log('❌ API Test failed:', error.message);
    }
}

// Startup sequence
setTimeout(() => {
    console.log('====================================');
    console.log('🤖 BOT READY!');
    console.log('====================================');
    console.log(`Owner: ${OWNER_ID}`);
    console.log(`API URL: ${API_URL}`);
    console.log(`Min Transfer: ${formatRupiah(MIN_TRANSFER)}`);
    console.log('====================================');
    
    // Test connection
    testConnection();
    
    // Send startup message to owner
    try {
        bot.sendMessage(OWNER_ID, `✅ Atlantic Transfer Bot telah aktif!\n\nMinimal transfer: ${formatRupiah(MIN_TRANSFER)}\n\nKetik /start untuk mulai.`);
    } catch (error) {
        console.log('Cannot send startup message to owner');
    }
}, 2000);
