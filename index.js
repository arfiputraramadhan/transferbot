require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// Inisialisasi bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Konfigurasi
const ATLANTIC_API_KEY = process.env.ATLANTIC_API_KEY;
const ATLANTIC_BASE_URL = process.env.ATLANTIC_BASE_URL || 'https://atlantich2h.com';
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

// Path database
const DB_PATH = path.join(__dirname, 'database.json');

// Inisialisasi database
let database = {
  users: [],
  transactions: [],
  settings: {
    owner_id: OWNER_TELEGRAM_ID,
    fee_percentage: 0.1,
    min_transfer: 10000,
    max_transfer: 10000000,
    api_key: ATLANTIC_API_KEY
  }
};

// Load database
const loadDatabase = async () => {
  try {
    if (await fs.pathExists(DB_PATH)) {
      const data = await fs.readJson(DB_PATH);
      database = data;
      console.log('Database loaded successfully');
    } else {
      await saveDatabase();
      console.log('New database created');
    }
  } catch (error) {
    console.error('Error loading database:', error);
  }
};

// Save database
const saveDatabase = async () => {
  try {
    await fs.writeJson(DB_PATH, database, { spaces: 2 });
  } catch (error) {
    console.error('Error saving database:', error);
  }
};

// API Helper Functions
const atlanticApi = axios.create({
  baseURL: ATLANTIC_BASE_URL,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
});

// Fungsi untuk mendapatkan list bank
const getBankList = async () => {
  try {
    const response = await atlanticApi.post('/transfer/bank_list', {
      api_key: database.settings.api_key
    });
    
    if (response.data.status) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('Error getting bank list:', error.response?.data || error.message);
    return [];
  }
};

// Fungsi untuk cek rekening
const checkAccount = async (bankCode, accountNumber) => {
  try {
    const response = await atlanticApi.post('/transfer/cek_rekening', {
      api_key: database.settings.api_key,
      bank_code: bankCode,
      account_number: accountNumber
    });
    
    return response.data;
  } catch (error) {
    console.error('Error checking account:', error.response?.data || error.message);
    return { status: false, message: 'Gagal cek rekening' };
  }
};

// Fungsi untuk membuat transfer
const createTransfer = async (transferData) => {
  try {
    const response = await atlanticApi.post('/transfer/create', {
      api_key: database.settings.api_key,
      ref_id: transferData.ref_id,
      kode_bank: transferData.kode_bank,
      nomor_akun: transferData.nomor_akun,
      nama_pemilik: transferData.nama_pemilik,
      nominal: transferData.nominal,
      email: transferData.email || '',
      phone: transferData.phone || '',
      note: transferData.note || ''
    });
    
    return response.data;
  } catch (error) {
    console.error('Error creating transfer:', error.response?.data || error.message);
    return { status: false, message: 'Gagal membuat transfer' };
  }
};

// Fungsi untuk cek status transfer
const checkTransferStatus = async (transactionId) => {
  try {
    const response = await atlanticApi.post('/transfer/status', {
      api_key: database.settings.api_key,
      id: transactionId
    });
    
    return response.data;
  } catch (error) {
    console.error('Error checking transfer status:', error.response?.data || error.message);
    return { status: false, message: 'Gagal cek status' };
  }
};

// Command Handlers
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (userId.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Bot ini hanya untuk owner!');
  }
  
  // Tambah user jika belum ada
  const existingUser = database.users.find(u => u.id === userId);
  if (!existingUser) {
    database.users.push({
      id: userId,
      username: msg.from.username || '',
      first_name: msg.from.first_name || '',
      last_name: msg.from.last_name || '',
      joined_at: new Date().toISOString()
    });
    await saveDatabase();
  }
  
  const welcomeMessage = `
🤖 *BOT TRANSFER ATLANTIC H2H*

Halo Owner! Selamat datang di bot transfer bank dan e-wallet.

*Perintah yang tersedia:*
/start - Memulai bot
/bank_list - Melihat daftar bank
/check_account - Cek rekening tujuan
/create_transfer - Buat transfer baru
/check_status - Cek status transfer
/history - Lihat riwayat transaksi
/settings - Pengaturan bot
/help - Bantuan

Gunakan menu di bawah untuk navigasi cepat:
  `;
  
  const keyboard = {
    reply_markup: {
      keyboard: [
        ['📋 Daftar Bank', '🔍 Cek Rekening'],
        ['💸 Transfer', '📊 Status Transfer'],
        ['📜 Riwayat', '⚙️ Pengaturan']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...keyboard });
});

bot.onText(/\/bank_list/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  bot.sendMessage(chatId, '🔄 Mengambil daftar bank...');
  
  const banks = await getBankList();
  
  if (banks.length === 0) {
    return bot.sendMessage(chatId, '❌ Gagal mengambil daftar bank');
  }
  
  let message = '🏦 *DAFTAR BANK & E-WALLET*\n\n';
  
  banks.forEach((bank, index) => {
    message += `*${index + 1}. ${bank.bank_name}*\n`;
    message += `   Kode: ${bank.bank_code}\n`;
    message += `   Tipe: ${bank.type}\n\n`;
  });
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/check_account/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  // Simpan state untuk step berikutnya
  bot.sendMessage(chatId, 'Masukkan kode bank (contoh: bca, mandiri, ovo):', {
    reply_markup: {
      force_reply: true
    }
  }).then(sentMsg => {
    bot.onReplyToMessage(chatId, sentMsg.message_id, async (replyMsg) => {
      const bankCode = replyMsg.text;
      
      bot.sendMessage(chatId, 'Masukkan nomor rekening/akun:', {
        reply_markup: {
          force_reply: true
        }
      }).then(sentMsg2 => {
        bot.onReplyToMessage(chatId, sentMsg2.message_id, async (replyMsg2) => {
          const accountNumber = replyMsg2.text;
          
          bot.sendMessage(chatId, '🔍 Memeriksa rekening...');
          
          const result = await checkAccount(bankCode, accountNumber);
          
          if (result.status) {
            const message = `
✅ *REKENING VALID*

📋 *Detail Rekening:*
🏦 Kode Bank: ${result.data.kode_bank}
📱 Nomor Akun: ${result.data.nomor_akun}
👤 Nama Pemilik: ${result.data.nama_pemilik}
✅ Status: ${result.data.status}

Rekening siap untuk transfer!
            `;
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, `❌ ${result.message || 'Gagal memeriksa rekening'}`);
          }
        });
      });
    });
  });
});

bot.onText(/\/create_transfer/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  // Langkah 1: Kode Bank
  bot.sendMessage(chatId, 'Masukkan kode bank (contoh: bca, mandiri, ovo):', {
    reply_markup: {
      force_reply: true
    }
  }).then(sentMsg => {
    let transferData = {};
    
    bot.onReplyToMessage(chatId, sentMsg.message_id, async (replyMsg) => {
      transferData.kode_bank = replyMsg.text;
      
      // Langkah 2: Nomor Akun
      bot.sendMessage(chatId, 'Masukkan nomor rekening/akun tujuan:', {
        reply_markup: {
          force_reply: true
        }
      }).then(sentMsg2 => {
        bot.onReplyToMessage(chatId, sentMsg2.message_id, async (replyMsg2) => {
          transferData.nomor_akun = replyMsg2.text;
          
          // Langkah 3: Nama Pemilik
          bot.sendMessage(chatId, 'Masukkan nama pemilik rekening:', {
            reply_markup: {
              force_reply: true
            }
          }).then(sentMsg3 => {
            bot.onReplyToMessage(chatId, sentMsg3.message_id, async (replyMsg3) => {
              transferData.nama_pemilik = replyMsg3.text;
              
              // Langkah 4: Nominal
              bot.sendMessage(chatId, 'Masukkan nominal transfer (min Rp 10.000):', {
                reply_markup: {
                  force_reply: true
                }
              }).then(sentMsg4 => {
                bot.onReplyToMessage(chatId, sentMsg4.message_id, async (replyMsg4) => {
                  const nominal = parseInt(replyMsg4.text);
                  
                  if (nominal < database.settings.min_transfer) {
                    return bot.sendMessage(chatId, `❌ Minimal transfer adalah Rp ${database.settings.min_transfer.toLocaleString()}`);
                  }
                  
                  if (nominal > database.settings.max_transfer) {
                    return bot.sendMessage(chatId, `❌ Maksimal transfer adalah Rp ${database.settings.max_transfer.toLocaleString()}`);
                  }
                  
                  transferData.nominal = nominal;
                  transferData.ref_id = `TRF-${Date.now()}`;
                  
                  // Langkah 5: Email (opsional)
                  bot.sendMessage(chatId, 'Masukkan email penerima (opsional, tekan /skip untuk melewati):', {
                    reply_markup: {
                      force_reply: true
                    }
                  }).then(sentMsg5 => {
                    bot.onReplyToMessage(chatId, sentMsg5.message_id, async (replyMsg5) => {
                      if (replyMsg5.text !== '/skip') {
                        transferData.email = replyMsg5.text;
                      }
                      
                      // Langkah 6: Phone (opsional)
                      bot.sendMessage(chatId, 'Masukkan nomor telepon penerima (opsional, tekan /skip untuk melewati):', {
                        reply_markup: {
                          force_reply: true
                        }
                      }).then(sentMsg6 => {
                        bot.onReplyToMessage(chatId, sentMsg6.message_id, async (replyMsg6) => {
                          if (replyMsg6.text !== '/skip') {
                            transferData.phone = replyMsg6.text;
                          }
                          
                          // Langkah 7: Catatan (opsional)
                          bot.sendMessage(chatId, 'Masukkan catatan transfer (opsional, tekan /skip untuk melewati):', {
                            reply_markup: {
                              force_reply: true
                            }
                          }).then(sentMsg7 => {
                            bot.onReplyToMessage(chatId, sentMsg7.message_id, async (replyMsg7) => {
                              if (replyMsg7.text !== '/skip') {
                                transferData.note = replyMsg7.text;
                              }
                              
                              // Konfirmasi transfer
                              const total = transferData.nominal;
                              const message = `
📋 *KONFIRMASI TRANSFER*

🏦 Kode Bank: ${transferData.kode_bank}
📱 Nomor Tujuan: ${transferData.nomor_akun}
👤 Nama Penerima: ${transferData.nama_pemilik}
💰 Nominal: Rp ${transferData.nominal.toLocaleString()}
📧 Email: ${transferData.email || '-'}
📞 Telepon: ${transferData.phone || '-'}
📝 Catatan: ${transferData.note || '-'}
🆔 Ref ID: ${transferData.ref_id}

*Total: Rp ${total.toLocaleString()}*

Apakah data sudah benar?
                              `;
                              
                              const keyboard = {
                                reply_markup: {
                                  inline_keyboard: [
                                    [
                                      { text: '✅ Ya, Lanjutkan', callback_data: `confirm_transfer_${JSON.stringify(transferData)}` },
                                      { text: '❌ Batal', callback_data: 'cancel_transfer' }
                                    ]
                                  ]
                                }
                              };
                              
                              bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Callback Query Handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  
  if (data.startsWith('confirm_transfer_')) {
    const transferDataStr = data.replace('confirm_transfer_', '');
    const transferData = JSON.parse(transferDataStr);
    
    bot.sendMessage(chatId, '🔄 Memproses transfer...');
    
    const result = await createTransfer(transferData);
    
    if (result.status) {
      // Simpan transaksi ke database
      const transaction = {
        id: result.data.id || uuidv4(),
        reff_id: result.data.reff_id || transferData.ref_id,
        user_id: chatId,
        bank_code: transferData.kode_bank,
        account_number: transferData.nomor_akun,
        account_name: transferData.nama_pemilik,
        nominal: transferData.nominal,
        fee: result.data.fee || 0,
        total: result.data.total || transferData.nominal,
        status: result.data.status || 'pending',
        created_at: new Date().toISOString(),
        atlantic_data: result.data
      };
      
      database.transactions.push(transaction);
      await saveDatabase();
      
      const message = `
✅ *TRANSFER BERHASIL DIPROSES*

📋 *Detail Transfer:*
🆔 ID Transaksi: ${result.data.id}
🆔 Ref ID: ${result.data.reff_id}
👤 Nama: ${result.data.name}
📱 Nomor Tujuan: ${result.data.nomor_tujuan}
💰 Nominal: Rp ${parseInt(result.data.nominal).toLocaleString()}
💸 Fee: Rp ${parseInt(result.data.fee || 0).toLocaleString()}
💵 Total: Rp ${parseInt(result.data.total || transferData.nominal).toLocaleString()}
✅ Status: ${result.data.status}
🏦 Bank: ${result.data.bank_code}
🕐 Waktu: ${result.data.created_at}

Transaksi telah direkam. Gunakan /check_status untuk memantau status.
      `;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ Gagal membuat transfer: ${result.message}`);
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
  } else if (data === 'cancel_transfer') {
    bot.sendMessage(chatId, '❌ Transfer dibatalkan');
    bot.answerCallbackQuery(callbackQuery.id);
  } else if (data.startsWith('check_status_')) {
    const transactionId = data.replace('check_status_', '');
    
    bot.sendMessage(chatId, '🔄 Memeriksa status...');
    
    const result = await checkTransferStatus(transactionId);
    
    if (result.status) {
      const message = `
📊 *STATUS TRANSFER*

🆔 ID: ${result.data.id}
👤 Nama: ${result.data.name}
💰 Nominal: Rp ${parseInt(result.data.nominal).toLocaleString()}
✅ Status: ${result.data.status}
🏦 Bank: ${result.data.bank_code}
🕐 Dibuat: ${result.data.created_at}

Status terakhir: ${result.data.status === 'success' ? '✅ Berhasil' : '⏳ Diproses'}
      `;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ ${result.message || 'Gagal memeriksa status'}`);
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
  }
});

bot.onText(/\/check_status/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  // Tampilkan transaksi terakhir
  const recentTransactions = database.transactions
    .filter(t => t.user_id === chatId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  
  if (recentTransactions.length === 0) {
    return bot.sendMessage(chatId, '📭 Belum ada transaksi');
  }
  
  let message = '📊 *TRANSAKSI TERAKHIR*\n\n';
  
  recentTransactions.forEach((transaction, index) => {
    message += `*${index + 1}. ${transaction.reff_id}*\n`;
    message += `   💰 Rp ${transaction.nominal.toLocaleString()}\n`;
    message += `   👤 ${transaction.account_name}\n`;
    message += `   📱 ${transaction.account_number}\n`;
    message += `   ✅ ${transaction.status}\n`;
    message += `   🕐 ${moment(transaction.created_at).format('DD/MM/YYYY HH:mm')}\n`;
    message += `   [Cek Status](tg://btn?${encodeURIComponent(JSON.stringify({ callback_data: `check_status_${transaction.id}` }))})\n\n`;
  });
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/history/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  const userTransactions = database.transactions
    .filter(t => t.user_id === chatId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  if (userTransactions.length === 0) {
    return bot.sendMessage(chatId, '📭 Belum ada riwayat transaksi');
  }
  
  let message = '📜 *RIWAYAT TRANSAKSI*\n\n';
  let totalAmount = 0;
  
  userTransactions.forEach((transaction, index) => {
    totalAmount += transaction.nominal;
    message += `*${index + 1}. ${transaction.reff_id}*\n`;
    message += `   🏦 ${transaction.bank_code.toUpperCase()}\n`;
    message += `   💰 Rp ${transaction.nominal.toLocaleString()}\n`;
    message += `   👤 ${transaction.account_name}\n`;
    message += `   ✅ ${transaction.status}\n`;
    message += `   🕐 ${moment(transaction.created_at).format('DD/MM/YYYY HH:mm')}\n\n`;
  });
  
  message += `*Total Transaksi:* Rp ${totalAmount.toLocaleString()}\n`;
  message += `*Jumlah Transaksi:* ${userTransactions.length}`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  const message = `
⚙️ *PENGATURAN BOT*

*Owner ID:* ${database.settings.owner_id}
*Fee Percentage:* ${(database.settings.fee_percentage * 100)}%
*Min Transfer:* Rp ${database.settings.min_transfer.toLocaleString()}
*Max Transfer:* Rp ${database.settings.max_transfer.toLocaleString()}
*API Key:* ${database.settings.api_key.substring(0, 10)}...

*Statistik:*
👥 Total Users: ${database.users.length}
💸 Total Transaksi: ${database.transactions.length}
💰 Total Volume: Rp ${database.transactions.reduce((sum, t) => sum + t.nominal, 0).toLocaleString()}

Gunakan perintah di bawah untuk mengubah:
/set_min_transfer [amount]
/set_max_transfer [amount]
/set_fee [percentage]
  `;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/set_min_transfer (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  const amount = parseInt(match[1]);
  if (isNaN(amount) || amount < 1000) {
    return bot.sendMessage(chatId, '❌ Jumlah tidak valid. Minimal Rp 1.000');
  }
  
  database.settings.min_transfer = amount;
  await saveDatabase();
  
  bot.sendMessage(chatId, `✅ Minimal transfer diubah menjadi Rp ${amount.toLocaleString()}`);
});

bot.onText(/\/set_max_transfer (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  const amount = parseInt(match[1]);
  if (isNaN(amount) || amount < 10000) {
    return bot.sendMessage(chatId, '❌ Jumlah tidak valid. Minimal Rp 10.000');
  }
  
  database.settings.max_transfer = amount;
  await saveDatabase();
  
  bot.sendMessage(chatId, `✅ Maksimal transfer diubah menjadi Rp ${amount.toLocaleString()}`);
});

bot.onText(/\/set_fee (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return bot.sendMessage(chatId, '❌ Akses ditolak!');
  }
  
  const percentage = parseFloat(match[1]);
  if (isNaN(percentage) || percentage < 0 || percentage > 100) {
    return bot.sendMessage(chatId, '❌ Persentase tidak valid (0-100)');
  }
  
  database.settings.fee_percentage = percentage / 100;
  await saveDatabase();
  
  bot.sendMessage(chatId, `✅ Fee percentage diubah menjadi ${percentage}%`);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
❓ *BANTUAN BOT TRANSFER ATLANTIC H2H*

*Perintah Tersedia:*
/start - Memulai bot
/bank_list - Melihat daftar bank dan e-wallet
/check_account - Cek validitas rekening tujuan
/create_transfer - Membuat transfer baru
/check_status - Cek status transfer terakhir
/history - Lihat riwayat transaksi
/settings - Pengaturan bot

*Fitur:*
✅ Transfer ke berbagai bank dan e-wallet
✅ Validasi rekening sebelum transfer
✅ Riwayat transaksi lengkap
✅ Status transfer real-time
✅ Keamanan hanya untuk owner

*Catatan:*
- Pastikan koneksi internet stabil
- Verifikasi data sebelum transfer
- Simpan ID transaksi untuk tracking

Untuk bantuan lebih lanjut, hubungi developer.
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Handler untuk tombol keyboard
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (msg.from.id.toString() !== database.settings.owner_id) {
    return;
  }
  
  if (text === '📋 Daftar Bank') {
    bot.sendMessage(chatId, '🔄 Mengambil daftar bank...');
    const banks = await getBankList();
    
    if (banks.length === 0) {
      return bot.sendMessage(chatId, '❌ Gagal mengambil daftar bank');
    }
    
    let message = '🏦 *DAFTAR BANK & E-WALLET*\n\n';
    banks.forEach((bank, index) => {
      message += `*${index + 1}. ${bank.bank_name}*\n`;
      message += `   Kode: ${bank.bank_code}\n`;
      message += `   Tipe: ${bank.type}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } else if (text === '🔍 Cek Rekening') {
    bot.sendMessage(chatId, 'Masukkan kode bank (contoh: bca, mandiri, ovo):', {
      reply_markup: {
        force_reply: true
      }
    });
  } else if (text === '💸 Transfer') {
    bot.sendMessage(chatId, 'Gunakan perintah /create_transfer untuk membuat transfer baru');
  } else if (text === '📊 Status Transfer') {
    bot.sendMessage(chatId, 'Gunakan perintah /check_status untuk cek status transfer');
  } else if (text === '📜 Riwayat') {
    bot.sendMessage(chatId, 'Gunakan perintah /history untuk melihat riwayat transaksi');
  } else if (text === '⚙️ Pengaturan') {
    bot.sendMessage(chatId, 'Gunakan perintah /settings untuk pengaturan bot');
  }
});

// Start bot
const startBot = async () => {
  await loadDatabase();
  
  console.log('🤖 Bot Telegram Atlantic H2H Transfer');
  console.log('====================================');
  console.log(`Owner ID: ${database.settings.owner_id}`);
  console.log(`API URL: ${ATLANTIC_BASE_URL}`);
  console.log('Bot sedang berjalan...');
  
  // Test API connection
  try {
    const banks = await getBankList();
    console.log(`✅ Terhubung ke API Atlantic`);
    console.log(`✅ Ditemukan ${banks.length} bank/e-wallet`);
  } catch (error) {
    console.log('❌ Gagal terhubung ke API Atlantic');
    console.log('Pastikan API key dan URL benar');
  }
};

startBot().catch(console.error);