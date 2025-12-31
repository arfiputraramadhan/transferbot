const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');
const DatabaseManager = require('./database-manager');
const AtlanticAPIClient = require('./api-client');

class BotManager {
  constructor() {
    this.bot = null;
    this.db = new DatabaseManager();
    this.apiClient = null;
    this.isRunning = false;
    this.userStates = new Map(); // Untuk menyimpan state user
    this.pendingCommands = new Map(); // Untuk menyimpan command yang sedang diproses
  }
  
  async initialize() {
    try {
      logger.startup('Initializing Bot Manager...');
      
      // Load environment
      require('dotenv').config();
      
      // Validate required environment variables
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const ownerId = process.env.OWNER_TELEGRAM_ID;
      const apiKey = process.env.ATLANTIC_API_KEY;
      
      if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is required in .env file');
      }
      
      if (!ownerId) {
        throw new Error('OWNER_TELEGRAM_ID is required in .env file');
      }
      
      if (!apiKey) {
        throw new Error('ATLANTIC_API_KEY is required in .env file');
      }
      
      // Initialize database
      await this.db.initialize();
      
      // Update owner ID from .env if different
      if (this.db.data.settings.owner_id !== ownerId) {
        this.db.data.settings.owner_id = ownerId;
        await this.db.save();
        logger.info('Owner ID updated from .env file');
      }
      
      // Update API key from .env if different
      if (this.db.data.settings.api_key !== apiKey) {
        this.db.data.settings.api_key = apiKey;
        await this.db.save();
        logger.info('API Key updated from .env file');
      }
      
      // Initialize API client
      const baseURL = process.env.ATLANTIC_BASE_URL || 'https://atlantich2h.com';
      this.apiClient = new AtlanticAPIClient(apiKey, baseURL);
      
      // Test API connection
      const apiTest = await this.apiClient.testConnection();
      if (!apiTest.connected) {
        logger.error('API Connection failed on startup', null, {
          message: apiTest.message
        });
        // Lanjutkan saja, mungkin koneksi akan pulih nanti
      }
      
      // Initialize bot dengan polling yang lebih robust
      this.bot = new TelegramBot(token, {
        polling: {
          interval: 300,
          autoStart: false,
          params: {
            timeout: parseInt(process.env.POLLING_TIMEOUT) || 60
          }
        }
      });
      
      // Setup error handlers
      this.setupErrorHandlers();
      
      // Setup command handlers
      this.setupCommands();
      
      // Setup message handlers
      this.setupMessageHandlers();
      
      // Setup callback query handlers
      this.setupCallbackHandlers();
      
      logger.startup('Bot Manager initialized successfully');
      return true;
      
    } catch (error) {
      logger.error('Failed to initialize Bot Manager', error);
      return false;
    }
  }
  
  setupErrorHandlers() {
    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      logger.error('Polling error occurred', error, {
        error_code: error.code,
        error_message: error.message
      });
      
      // Auto-restart logic
      if (error.code === 'EFATAL') {
        logger.warn('Fatal polling error, attempting to restart...');
        setTimeout(() => {
          this.restartBot();
        }, 5000);
      }
    });
    
    // Handle webhook errors
    this.bot.on('webhook_error', (error) => {
      logger.error('Webhook error occurred', error);
    });
    
    // Handle errors from command handlers
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', reason, {
        promise: promise,
        type: 'unhandled_rejection'
      });
    });
    
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception thrown:', error, {
        type: 'uncaught_exception'
      });
      
      // Graceful shutdown
      this.shutdown().then(() => {
        process.exit(1);
      });
    });
  }
  
  setupCommands() {
    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      await this.handleStart(msg);
    });
    
    // Bank list command
    this.bot.onText(/\/banklist/, async (msg) => {
      await this.handleBankList(msg);
    });
    
    // Check account command
    this.bot.onText(/\/checkaccount/, async (msg) => {
      await this.handleCheckAccount(msg);
    });
    
    // Create transfer command
    this.bot.onText(/\/createtransfer/, async (msg) => {
      await this.handleCreateTransfer(msg);
    });
    
    // Check status command
    this.bot.onText(/\/checkstatus/, async (msg) => {
      await this.handleCheckStatus(msg);
    });
    
    // History command
    this.bot.onText(/\/history/, async (msg) => {
      await this.handleHistory(msg);
    });
    
    // Settings command
    this.bot.onText(/\/settings/, async (msg) => {
      await this.handleSettings(msg);
    });
    
    // Help command
    this.bot.onText(/\/help/, async (msg) => {
      await this.handleHelp(msg);
    });
    
    // Deposit command
    this.bot.onText(/\/deposit/, async (msg) => {
      await this.handleDeposit(msg);
    });
    
    // Stats command
    this.bot.onText(/\/stats/, async (msg) => {
      await this.handleStats(msg);
    });
    
    // Logs command (for owner only)
    this.bot.onText(/\/logs/, async (msg) => {
      await this.handleLogs(msg);
    });
    
    // Backup command (for owner only)
    this.bot.onText(/\/backup/, async (msg) => {
      await this.handleBackup(msg);
    });
  }
  
  setupMessageHandlers() {
    // Handle text messages (for wizard steps)
    this.bot.on('message', async (msg) => {
      try {
        // Skip non-text messages
        if (!msg.text) return;
        
        // Skip commands (already handled)
        if (msg.text.startsWith('/')) return;
        
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        // Check if user is in a wizard state
        const userState = this.userStates.get(`${userId}:${chatId}`);
        if (userState) {
          await this.handleWizardStep(msg, userState);
        }
        
        // Handle keyboard button presses
        await this.handleKeyboardButtons(msg);
        
      } catch (error) {
        logger.error('Error handling message', error, {
          user_id: msg.from?.id,
          chat_id: msg.chat.id,
          message_text: msg.text?.substring(0, 100)
        });
      }
    });
  }
  
  setupCallbackHandlers() {
    this.bot.on('callback_query', async (callbackQuery) => {
      try {
        await this.handleCallbackQuery(callbackQuery);
      } catch (error) {
        logger.error('Error handling callback query', error, {
          callback_data: callbackQuery.data,
          user_id: callbackQuery.from.id
        });
        
        // Answer callback query to prevent loading indicator
        try {
          await this.bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Terjadi error, silakan coba lagi',
            show_alert: true
          });
        } catch (e) {
          // Ignore
        }
      }
    });
  }
  
  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/start', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    // Add/update user in database
    this.db.addUser({
      id: userId,
      username: msg.from.username || '',
      first_name: msg.from.first_name || '',
      last_name: msg.from.last_name || '',
      language_code: msg.from.language_code || 'id'
    });
    
    // Welcome message
    const welcomeMessage = `
🤖 *BOT TRANSFER ATLANTIC H2H*

Halo Owner! Selamat datang di bot transfer bank dan e-wallet.

*Perintah yang tersedia:*
/start - Memulai bot
/banklist - Melihat daftar bank
/checkaccount - Cek rekening tujuan
/createtransfer - Buat transfer baru
/checkstatus - Cek status transfer
/deposit - Buat deposit (min Rp ${this.db.data.settings.min_deposit.toLocaleString()})
/history - Lihat riwayat transaksi
/settings - Pengaturan bot
/stats - Statistik sistem
/help - Bantuan

*Minimal Deposit:* Rp ${this.db.data.settings.min_deposit.toLocaleString()}
*Maksimal Deposit:* Rp ${this.db.data.settings.max_deposit.toLocaleString()}

Gunakan menu di bawah untuk navigasi cepat:
    `;
    
    // Create custom keyboard
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['📋 Daftar Bank', '🔍 Cek Rekening'],
          ['💸 Transfer', '💰 Deposit'],
          ['📊 Status', '📜 Riwayat'],
          ['⚙️ Pengaturan', '📈 Stats']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    };
    
    try {
      await this.bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      
      logger.user('User started bot', userId, 'start', {
        username: msg.from.username,
        first_name: msg.from.first_name
      });
      
    } catch (error) {
      logger.error('Failed to send start message', error, {
        user_id: userId,
        chat_id: chatId
      });
    }
  }
  
  async handleBankList(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/banklist', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    try {
      await this.bot.sendChatAction(chatId, 'typing');
      const loadingMsg = await this.bot.sendMessage(chatId, '🔄 Mengambil daftar bank...');
      
      const result = await this.apiClient.getBankList();
      
      if (result.success && result.data.length > 0) {
        let message = '🏦 *DAFTAR BANK & E-WALLET*\n\n';
        
        // Group by type
        const banksByType = {};
        result.data.forEach(bank => {
          if (!banksByType[bank.type]) {
            banksByType[bank.type] = [];
          }
          banksByType[bank.type].push(bank);
        });
        
        // Format message by type
        for (const [type, banks] of Object.entries(banksByType)) {
          message += `*${type.toUpperCase()}*\n`;
          banks.forEach((bank, index) => {
            message += `${index + 1}. *${bank.bank_name}*\n`;
            message += `   Kode: \`${bank.bank_code}\`\n\n`;
          });
        }
        
        message += `\nTotal: *${result.data.length}* bank/e-wallet tersedia`;
        
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        });
        
        logger.user('Bank list retrieved', userId, 'banklist', {
          bank_count: result.data.length
        });
        
      } else {
        await this.bot.editMessageText('❌ Gagal mengambil daftar bank. Coba lagi nanti.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
      
    } catch (error) {
      logger.error('Failed to handle banklist command', error, {
        user_id: userId,
        chat_id: chatId
      });
      
      try {
        await this.bot.sendMessage(chatId, '❌ Terjadi error saat mengambil daftar bank.');
      } catch (e) {
        // Ignore
      }
    }
  }
  
  async handleCheckAccount(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/checkaccount', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    // Start account check wizard
    this.userStates.set(`${userId}:${chatId}`, {
      wizard: 'check_account',
      step: 1,
      data: {}
    });
    
    await this.bot.sendMessage(chatId, 'Masukkan kode bank (contoh: `bca`, `mandiri`, `ovo`):', {
      parse_mode: 'Markdown',
      reply_markup: {
        force_reply: true
      }
    });
  }
  
  async handleCreateTransfer(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/createtransfer', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    // Start transfer wizard
    this.userStates.set(`${userId}:${chatId}`, {
      wizard: 'create_transfer',
      step: 1,
      data: {}
    });
    
    await this.bot.sendMessage(chatId, 'Masukkan kode bank tujuan (contoh: `bca`, `mandiri`, `ovo`):', {
      parse_mode: 'Markdown',
      reply_markup: {
        force_reply: true
      }
    });
  }
  
  async handleCheckStatus(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/checkstatus', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    // Get recent transactions
    const transactions = this.db.getUserTransactions(userId, 5);
    
    if (transactions.length === 0) {
      await this.bot.sendMessage(chatId, '📭 Belum ada transaksi.');
      return;
    }
    
    let message = '📊 *TRANSAKSI TERAKHIR*\n\n';
    
    transactions.forEach((tx, index) => {
      const statusEmoji = tx.status === 'success' ? '✅' : 
                         tx.status === 'pending' ? '⏳' : '❌';
      
      message += `${index + 1}. *${tx.reff_id}*\n`;
      message += `   💰 Rp ${tx.nominal.toLocaleString()}\n`;
      message += `   👤 ${tx.account_name}\n`;
      message += `   📱 ${tx.account_number}\n`;
      message += `   ${statusEmoji} ${tx.status}\n`;
      message += `   🕐 ${new Date(tx.created_at).toLocaleString('id-ID')}\n`;
      message += `   [Cek Status](https://t.me/${this.bot.options.username}?start=status_${tx.id})\n\n`;
    });
    
    message += 'Klik link "Cek Status" untuk update status terbaru.';
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  }
  
  async handleDeposit(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/deposit', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    const minDeposit = this.db.data.settings.min_deposit;
    const maxDeposit = this.db.data.settings.max_deposit;
    
    // Start deposit wizard
    this.userStates.set(`${userId}:${chatId}`, {
      wizard: 'create_deposit',
      step: 1,
      data: {}
    });
    
    await this.bot.sendMessage(chatId, `Masukkan nominal deposit (min Rp ${minDeposit.toLocaleString()}, max Rp ${maxDeposit.toLocaleString()}):`, {
      parse_mode: 'Markdown',
      reply_markup: {
        force_reply: true
      }
    });
  }
  
  async handleHistory(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/history', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    // Get user transactions and deposits
    const transactions = this.db.getUserTransactions(userId, 10);
    const deposits = this.db.getUserDeposits(userId, 10);
    
    if (transactions.length === 0 && deposits.length === 0) {
      await this.bot.sendMessage(chatId, '📭 Belum ada riwayat transaksi.');
      return;
    }
    
    let message = '📜 *RIWAYAT TRANSAKSI & DEPOSIT*\n\n';
    
    // Combine and sort by date
    const allRecords = [...transactions, ...deposits]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    
    allRecords.forEach((record, index) => {
      const isDeposit = record.type === 'deposit';
      const emoji = isDeposit ? '💰' : '💸';
      const typeText = isDeposit ? 'Deposit' : 'Transfer';
      const statusEmoji = record.status === 'success' ? '✅' : 
                         record.status === 'pending' ? '⏳' : '❌';
      
      message += `${index + 1}. ${emoji} *${typeText}*\n`;
      message += `   🆔 ${record.reff_id}\n`;
      message += `   💰 Rp ${record.nominal.toLocaleString()}\n`;
      
      if (!isDeposit) {
        message += `   👤 ${record.account_name}\n`;
        message += `   📱 ${record.account_number}\n`;
      }
      
      message += `   ${statusEmoji} ${record.status}\n`;
      message += `   🕐 ${new Date(record.created_at).toLocaleString('id-ID')}\n\n`;
    });
    
    // Add totals
    const totalTransfers = transactions.filter(t => t.status === 'success').reduce((sum, t) => sum + t.nominal, 0);
    const totalDeposits = deposits.filter(d => d.status === 'success').reduce((sum, d) => sum + d.nominal, 0);
    
    message += `*Total Transfer:* Rp ${totalTransfers.toLocaleString()}\n`;
    message += `*Total Deposit:* Rp ${totalDeposits.toLocaleString()}\n`;
    message += `*Total Records:* ${allRecords.length}`;
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }
  
  async handleSettings(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/settings', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    const settings = this.db.data.settings;
    const stats = this.db.getSystemStats();
    
    let message = '⚙️ *PENGATURAN BOT*\n\n';
    
    message += `*Owner ID:* \`${settings.owner_id}\`\n`;
    message += `*Min Deposit:* Rp ${settings.min_deposit.toLocaleString()}\n`;
    message += `*Max Deposit:* Rp ${settings.max_deposit.toLocaleString()}\n`;
    message += `*Fee Percentage:* ${(settings.fee_percentage * 100)}%\n`;
    message += `*Auto Retry:* ${settings.auto_retry ? '✅' : '❌'}\n`;
    message += `*Max Retry:* ${settings.max_retry}\n`;
    message += `*API Key:* \`${settings.api_key.substring(0, 10)}...\`\n\n`;
    
    message += '*Statistik:*\n';
    message += `👥 Total Users: ${stats.total_users}\n`;
    message += `💸 Total Transaksi: ${stats.total_transactions}\n`;
    message += `💰 Total Deposit: ${stats.total_deposits}\n`;
    message += `📈 Total Volume: Rp ${stats.total_volume.toLocaleString()}\n`;
    message += `⏳ Pending: ${stats.pending_transactions} transaksi, ${stats.pending_deposits} deposit\n\n`;
    
    message += '*Perintah Pengaturan:*\n';
    message += '`/setmindeposit [jumlah]` - Set minimal deposit\n';
    message += '`/setmaxdeposit [jumlah]` - Set maksimal deposit\n';
    message += '`/setfee [persentase]` - Set persentase fee\n';
    message += '`/togglelogging` - Aktifkan/nonaktifkan logging\n';
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }
  
  async handleStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/stats', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    const stats = this.db.getSystemStats();
    const uptime = process.uptime();
    
    let message = '📈 *STATISTIK SISTEM*\n\n';
    
    message += '*Performansi:*\n';
    message += `⏱️ Uptime: ${this.formatUptime(uptime)}\n`;
    message += `📊 Total Requests: ${stats.total_requests}\n`;
    message += `❌ Failed Requests: ${stats.failed_requests}\n`;
    message += `✅ Success Rate: ${stats.total_requests > 0 ? ((1 - stats.failed_requests/stats.total_requests) * 100).toFixed(2) : 0}%\n\n`;
    
    message += '*Transaksi:*\n';
    message += `✅ Successful Transfers: ${stats.successful_transfers}\n`;
    message += `💰 Successful Deposits: ${stats.successful_deposits}\n`;
    message += `💵 Total Volume: Rp ${stats.total_volume.toLocaleString()}\n`;
    message += `⏳ Pending: ${stats.pending_transactions} transaksi, ${stats.pending_deposits} deposit\n\n`;
    
    message += '*Pengguna:*\n';
    message += `👥 Total Users: ${stats.total_users}\n`;
    message += `📅 Last Startup: ${new Date(stats.last_startup).toLocaleString('id-ID')}\n`;
    message += `💾 Last Backup: ${stats.last_backup ? new Date(stats.last_backup).toLocaleString('id-ID') : 'Never'}\n`;
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  }
  
  async handleHelp(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/help', userId, chatId);
    
    const helpMessage = `
❓ *BANTUAN BOT TRANSFER ATLANTIC H2H*

*Perintah Tersedia:*
/start - Memulai bot
/banklist - Melihat daftar bank dan e-wallet
/checkaccount - Cek validitas rekening tujuan
/createtransfer - Membuat transfer baru
/checkstatus - Cek status transfer terakhir
/deposit - Buat deposit baru
/history - Lihat riwayat transaksi & deposit
/settings - Pengaturan bot
/stats - Statistik sistem
/help - Bantuan

*Fitur:*
✅ Transfer ke berbagai bank dan e-wallet
✅ Deposit dengan minimal Rp ${this.db.data.settings.min_deposit.toLocaleString()}
✅ Validasi rekening sebelum transfer
✅ Riwayat transaksi lengkap
✅ Status transfer real-time
✅ Keamanan hanya untuk owner
✅ Sistem logging yang lengkap
✅ Auto-retry pada error

*Catatan:*
- Minimal deposit: Rp ${this.db.data.settings.min_deposit.toLocaleString()}
- Maksimal deposit: Rp ${this.db.data.settings.max_deposit.toLocaleString()}
- Pastikan koneksi internet stabil
- Verifikasi data sebelum transfer
- Simpan ID transaksi untuk tracking

*Tips:*
- Gunakan keyboard untuk navigasi cepat
- Cek status transfer secara berkala
- Backup database secara rutin

Untuk masalah teknis, periksa log dengan /logs (owner only).
    `;
    
    await this.bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'Markdown'
    });
  }
  
  async handleLogs(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/logs', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    try {
      await this.bot.sendChatAction(chatId, 'typing');
      
      // Get recent logs
      const logs = await logger.getRecentLogs(20);
      
      if (logs.length === 0) {
        await this.bot.sendMessage(chatId, '📭 Belum ada log.');
        return;
      }
      
      let message = '📋 *LOG TERBARU*\n\n';
      
      logs.slice(0, 10).forEach((log, index) => {
        if (typeof log === 'object') {
          const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('id-ID') : 'N/A';
          const level = log.level || 'info';
          const levelEmoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
          
          message += `${index + 1}. ${levelEmoji} *${level.toUpperCase()}*\n`;
          message += `   🕐 ${time}\n`;
          message += `   📝 ${log.message || 'No message'}\n`;
          
          if (log.metadata?.type) {
            message += `   📂 ${log.metadata.type}\n`;
          }
          
          if (log.metadata?.user_id) {
            message += `   👤 User: ${log.metadata.user_id}\n`;
          }
          
          message += '\n';
        } else {
          message += `${index + 1}. ${log}\n\n`;
        }
      });
      
      message += `\nTotal log entries: ${logs.length}`;
      
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      logger.error('Failed to handle logs command', error);
      await this.bot.sendMessage(chatId, '❌ Gagal mengambil log.');
    }
  }
  
  async handleBackup(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    logger.command('/backup', userId, chatId);
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    try {
      await this.bot.sendChatAction(chatId, 'typing');
      
      // Create backup
      const backupFile = await this.db.createBackup();
      
      if (backupFile) {
        const stats = await require('fs').promises.stat(backupFile);
        const fileSize = (stats.size / 1024).toFixed(2);
        
        await this.bot.sendMessage(chatId, `✅ Backup berhasil dibuat!\n\n📁 File: ${backupFile}\n📏 Size: ${fileSize} KB\n\nDatabase telah di-backup.`);
        
        logger.user('Manual backup created', userId, 'backup', {
          backup_file: backupFile,
          file_size: fileSize
        });
      } else {
        await this.bot.sendMessage(chatId, '❌ Gagal membuat backup.');
      }
      
    } catch (error) {
      logger.error('Failed to handle backup command', error);
      await this.bot.sendMessage(chatId, '❌ Gagal membuat backup.');
    }
  }
  
  async handleWizardStep(msg, state) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    try {
      switch (state.wizard) {
        case 'check_account':
          await this.handleCheckAccountWizard(msg, state);
          break;
          
        case 'create_transfer':
          await this.handleCreateTransferWizard(msg, state);
          break;
          
        case 'create_deposit':
          await this.handleCreateDepositWizard(msg, state);
          break;
          
        default:
          // Clear invalid state
          this.userStates.delete(`${userId}:${chatId}`);
      }
    } catch (error) {
      logger.error('Error in wizard step', error, {
        user_id: userId,
        wizard: state.wizard,
        step: state.step
      });
      
      await this.bot.sendMessage(chatId, '❌ Terjadi error, silakan coba lagi dari awal.');
      this.userStates.delete(`${userId}:${chatId}`);
    }
  }
  
  async handleCheckAccountWizard(msg, state) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    switch (state.step) {
      case 1:
        // Step 1: Bank code
        state.data.bank_code = text.toLowerCase().trim();
        state.step = 2;
        this.userStates.set(`${userId}:${chatId}`, state);
        
        await this.bot.sendMessage(chatId, 'Masukkan nomor rekening/akun tujuan:', {
          reply_markup: { force_reply: true }
        });
        break;
        
      case 2:
        // Step 2: Account number
        state.data.account_number = text.trim();
        this.userStates.delete(`${userId}:${chatId}`);
        
        await this.bot.sendChatAction(chatId, 'typing');
        const loadingMsg = await this.bot.sendMessage(chatId, '🔍 Memeriksa rekening...');
        
        const result = await this.apiClient.checkAccount(
          state.data.bank_code,
          state.data.account_number
        );
        
        if (result.success && result.data) {
          let message = '✅ *REKENING VALID*\n\n';
          message += `🏦 *Bank:* ${state.data.bank_code.toUpperCase()}\n`;
          message += `📱 *Nomor Akun:* ${state.data.account_number}\n`;
          message += `👤 *Nama Pemilik:* ${result.data.nama_pemilik || 'Tidak diketahui'}\n`;
          message += `✅ *Status:* ${result.data.status || 'valid'}\n\n`;
          message += 'Rekening siap untuk transfer!';
          
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'Markdown'
          });
        } else {
          await this.bot.editMessageText(`❌ ${result.message || 'Rekening tidak valid'}`, {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          });
        }
        break;
    }
  }
  
  async handleCreateTransferWizard(msg, state) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    switch (state.step) {
      case 1:
        // Step 1: Bank code
        state.data.kode_bank = text.toLowerCase().trim();
        state.step = 2;
        this.userStates.set(`${userId}:${chatId}`, state);
        
        await this.bot.sendMessage(chatId, 'Masukkan nomor rekening/akun tujuan:', {
          reply_markup: { force_reply: true }
        });
        break;
        
      case 2:
        // Step 2: Account number
        state.data.nomor_akun = text.trim();
        state.step = 3;
        this.userStates.set(`${userId}:${chatId}`, state);
        
        await this.bot.sendMessage(chatId, 'Masukkan nama pemilik rekening:', {
          reply_markup: { force_reply: true }
        });
        break;
        
      case 3:
        // Step 3: Account name
        state.data.nama_pemilik = text.trim();
        state.step = 4;
        this.userStates.set(`${userId}:${chatId}`, state);
        
        await this.bot.sendMessage(chatId, 'Masukkan nominal transfer:', {
          reply_markup: { force_reply: true }
        });
        break;
        
      case 4:
        // Step 4: Amount
        const amount = parseInt(text.replace(/[^0-9]/g, ''));
        
        if (isNaN(amount) || amount < 1000) {
          await this.bot.sendMessage(chatId, '❌ Nominal tidak valid. Minimal Rp 1.000');
          this.userStates.delete(`${userId}:${chatId}`);
          return;
        }
        
        state.data.nominal = amount;
        state.data.ref_id = `TRF-${Date.now()}`;
        this.userStates.delete(`${userId}:${chatId}`);
        
        // Show confirmation
        const total = amount;
        const message = `
📋 *KONFIRMASI TRANSFER*

🏦 *Bank:* ${state.data.kode_bank.toUpperCase()}
📱 *Nomor Tujuan:* ${state.data.nomor_akun}
👤 *Nama Penerima:* ${state.data.nama_pemilik}
💰 *Nominal:* Rp ${amount.toLocaleString()}
🆔 *Ref ID:* ${state.data.ref_id}

*Total: Rp ${total.toLocaleString()}*

Apakah data sudah benar?
        `;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '✅ Ya, Lanjutkan', 
                  callback_data: `confirm_transfer:${JSON.stringify(state.data)}` 
                },
                { 
                  text: '❌ Batal', 
                  callback_data: 'cancel_action' 
                }
              ]
            ]
          }
        };
        
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          ...keyboard
        });
        break;
    }
  }
  
  async handleCreateDepositWizard(msg, state) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    switch (state.step) {
      case 1:
        // Step 1: Amount
        const amount = parseInt(text.replace(/[^0-9]/g, ''));
        const minDeposit = this.db.data.settings.min_deposit;
        const maxDeposit = this.db.data.settings.max_deposit;
        
        if (isNaN(amount) || amount < minDeposit) {
          await this.bot.sendMessage(chatId, `❌ Nominal tidak valid. Minimal Rp ${minDeposit.toLocaleString()}`);
          this.userStates.delete(`${userId}:${chatId}`);
          return;
        }
        
        if (amount > maxDeposit) {
          await this.bot.sendMessage(chatId, `❌ Nominal melebihi batas. Maksimal Rp ${maxDeposit.toLocaleString()}`);
          this.userStates.delete(`${userId}:${chatId}`);
          return;
        }
        
        state.data.nominal = amount;
        state.data.ref_id = `DEP-${Date.now()}`;
        this.userStates.delete(`${userId}:${chatId}`);
        
        // Show confirmation
        const fee = Math.round(amount * this.db.data.settings.fee_percentage);
        const total = amount + fee;
        
        const message = `
💰 *KONFIRMASI DEPOSIT*

📊 *Nominal:* Rp ${amount.toLocaleString()}
💸 *Fee (${(this.db.data.settings.fee_percentage * 100)}%):* Rp ${fee.toLocaleString()}
💵 *Total:* Rp ${total.toLocaleString()}
🆔 *Ref ID:* ${state.data.ref_id}

Apakah data sudah benar?
        `;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '✅ Ya, Lanjutkan', 
                  callback_data: `confirm_deposit:${JSON.stringify(state.data)}` 
                },
                { 
                  text: '❌ Batal', 
                  callback_data: 'cancel_action' 
                }
              ]
            ]
          }
        };
        
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          ...keyboard
        });
        break;
    }
  }
  
  async handleKeyboardButtons(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) return;
    
    switch (text) {
      case '📋 Daftar Bank':
        await this.handleBankList(msg);
        break;
        
      case '🔍 Cek Rekening':
        await this.handleCheckAccount(msg);
        break;
        
      case '💸 Transfer':
        await this.handleCreateTransfer(msg);
        break;
        
      case '💰 Deposit':
        await this.handleDeposit(msg);
        break;
        
      case '📊 Status':
        await this.handleCheckStatus(msg);
        break;
        
      case '📜 Riwayat':
        await this.handleHistory(msg);
        break;
        
      case '⚙️ Pengaturan':
        await this.handleSettings(msg);
        break;
        
      case '📈 Stats':
        await this.handleStats(msg);
        break;
    }
  }
  
  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    logger.debug('Callback query received', {
      callback_data: data,
      user_id: userId,
      chat_id: chatId
    });
    
    // Check if user is owner
    const isOwner = await this.isOwner(userId, chatId);
    if (!isOwner) {
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Akses ditolak!',
        show_alert: true
      });
      return;
    }
    
    if (data.startsWith('confirm_transfer:')) {
      await this.handleConfirmTransfer(callbackQuery);
    } else if (data.startsWith('confirm_deposit:')) {
      await this.handleConfirmDeposit(callbackQuery);
    } else if (data === 'cancel_action') {
      await this.bot.editMessageText('❌ Aksi dibatalkan.', {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id
      });
      await this.bot.answerCallbackQuery(callbackQuery.id);
    }
  }
  
  async handleConfirmTransfer(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
      const transferDataStr = data.replace('confirm_transfer:', '');
      const transferData = JSON.parse(transferDataStr);
      
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Memproses transfer...',
        show_alert: false
      });
      
      await this.bot.editMessageText('🔄 Memproses transfer...', {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id
      });
      
      const result = await this.apiClient.createTransfer(transferData);
      
      if (result.success) {
        // Save to database
        const transaction = this.db.addTransaction({
          user_id: userId,
          type: 'transfer',
          bank_code: transferData.kode_bank,
          account_number: transferData.nomor_akun,
          account_name: transferData.nama_pemilik,
          nominal: transferData.nominal,
          fee: result.data?.fee || 0,
          total: result.data?.total || transferData.nominal,
          status: result.data?.status || 'pending',
          reff_id: transferData.ref_id,
          metadata: {
            atlantic_id: result.data?.id,
            bank_code: result.data?.bank_code,
            created_at: result.data?.created_at
          }
        });
        
        let message = '✅ *TRANSFER DIPROSES*\n\n';
        message += `🆔 *ID:* ${result.data?.id || transaction.id}\n`;
        message += `🆔 *Ref ID:* ${result.data?.reff_id || transferData.ref_id}\n`;
        message += `👤 *Nama:* ${result.data?.name || transferData.nama_pemilik}\n`;
        message += `📱 *Tujuan:* ${result.data?.nomor_tujuan || transferData.nomor_akun}\n`;
        message += `💰 *Nominal:* Rp ${parseInt(result.data?.nominal || transferData.nominal).toLocaleString()}\n`;
        message += `💸 *Fee:* Rp ${parseInt(result.data?.fee || 0).toLocaleString()}\n`;
        message += `💵 *Total:* Rp ${parseInt(result.data?.total || transferData.nominal).toLocaleString()}\n`;
        message += `✅ *Status:* ${result.data?.status || 'diproses'}\n`;
        message += `🏦 *Bank:* ${result.data?.bank_code || transferData.kode_bank}\n`;
        message += `🕐 *Waktu:* ${result.data?.created_at || new Date().toLocaleString('id-ID')}\n\n`;
        message += 'Gunakan /checkstatus untuk memantau status transfer.';
        
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id,
          parse_mode: 'Markdown'
        });
        
        logger.transfer('Transfer confirmed and created', {
          transaction_id: transaction.id,
          user_id: userId,
          amount: transferData.nominal,
          status: result.data?.status || 'pending'
        });
        
      } else {
        await this.bot.editMessageText(`❌ Gagal membuat transfer: ${result.message}`, {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id
        });
      }
      
    } catch (error) {
      logger.error('Failed to confirm transfer', error, {
        user_id: userId,
        callback_data: data
      });
      
      await this.bot.editMessageText('❌ Terjadi error saat memproses transfer.', {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id
      });
    }
  }
  
  async handleConfirmDeposit(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
      const depositDataStr = data.replace('confirm_deposit:', '');
      const depositData = JSON.parse(depositDataStr);
      
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Memproses deposit...',
        show_alert: false
      });
      
      await this.bot.editMessageText('🔄 Memproses deposit...', {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id
      });
      
      // Simulate deposit processing (in real app, this would call payment API)
      // For now, we'll just save it as pending
      const fee = Math.round(depositData.nominal * this.db.data.settings.fee_percentage);
      const total = depositData.nominal + fee;
      
      const deposit = this.db.addDeposit({
        user_id: userId,
        type: 'deposit',
        method: 'manual',
        nominal: depositData.nominal,
        fee: fee,
        total: total,
        status: 'pending',
        reff_id: depositData.ref_id,
        note: 'Menunggu konfirmasi manual'
      });
      
      let message = '💰 *DEPOSIT DIBUAT*\n\n';
      message += `🆔 *ID:* ${deposit.id}\n`;
      message += `🆔 *Ref ID:* ${deposit.reff_id}\n`;
      message += `💰 *Nominal:* Rp ${deposit.nominal.toLocaleString()}\n`;
      message += `💸 *Fee:* Rp ${deposit.fee.toLocaleString()}\n`;
      message += `💵 *Total:* Rp ${deposit.total.toLocaleString()}\n`;
      message += `✅ *Status:* ${deposit.status}\n`;
      message += `📝 *Note:* ${deposit.note}\n`;
      message += `🕐 *Waktu:* ${new Date(deposit.created_at).toLocaleString('id-ID')}\n\n`;
      message += 'Deposit dalam status pending. Admin akan memverifikasi manual.';
      
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown'
      });
      
      logger.deposit('Deposit created', {
        deposit_id: deposit.id,
        user_id: userId,
        amount: deposit.nominal,
        status: deposit.status
      });
      
    } catch (error) {
      logger.error('Failed to confirm deposit', error, {
        user_id: userId,
        callback_data: data
      });
      
      await this.bot.editMessageText('❌ Terjadi error saat memproses deposit.', {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id
      });
    }
  }
  
  async isOwner(userId, chatId) {
    const ownerId = this.db.data.settings.owner_id;
    const isOwner = userId.toString() === ownerId.toString();
    
    if (!isOwner) {
      try {
        await this.bot.sendMessage(chatId, '❌ Bot ini hanya untuk owner!');
        logger.warn('Non-owner access attempt', {
          user_id: userId,
          owner_id: ownerId
        });
      } catch (error) {
        // Ignore send errors
      }
    }
    
    return isOwner;
  }
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} detik`);
    
    return parts.join(' ');
  }
  
  async start() {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }
    
    try {
      logger.startup('Starting Telegram bot...');
      
      // Start polling
      await this.bot.startPolling();
      this.isRunning = true;
      
      logger.startup('Bot started successfully', {
        bot_username: this.bot.options.username,
        polling: true
      });
      
      // Send startup notification to owner
      await this.sendOwnerNotification('Bot telah dimulai! 🚀');
      
    } catch (error) {
      logger.error('Failed to start bot', error);
      this.isRunning = false;
      throw error;
    }
  }
  
  async stop() {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }
    
    try {
      logger.shutdown('Stopping Telegram bot...');
      
      // Stop polling
      this.bot.stopPolling();
      this.isRunning = false;
      
      logger.shutdown('Bot stopped successfully');
      
    } catch (error) {
      logger.error('Failed to stop bot', error);
      throw error;
    }
  }
  
  async restartBot() {
    logger.warn('Restarting bot...');
    
    try {
      await this.stop();
      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.start();
      
      logger.info('Bot restarted successfully');
    } catch (error) {
      logger.error('Failed to restart bot', error);
    }
  }
  
  async shutdown() {
    logger.shutdown('Shutting down bot manager...');
    
    try {
      // Save database
      await this.db.save();
      
      // Stop bot
      if (this.isRunning) {
        await this.stop();
      }
      
      // Send shutdown notification
      await this.sendOwnerNotification('Bot dimatikan! 🔴');
      
      logger.shutdown('Bot manager shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', error);
    }
  }
  
  async sendOwnerNotification(message) {
    try {
      const ownerId = this.db.data.settings.owner_id;
      if (ownerId && this.db.data.settings.notification_enabled) {
        await this.bot.sendMessage(ownerId, message, {
          parse_mode: 'Markdown'
        });
      }
    } catch (error) {
      logger.error('Failed to send owner notification', error);
    }
  }
  
  // Cleanup old user states (run periodically)
  cleanupUserStates() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    
    for (const [key, state] of this.userStates.entries()) {
      if (state.timestamp && (now - state.timestamp) > timeout) {
        this.userStates.delete(key);
        logger.debug('Cleaned up expired user state', { state_key: key });
      }
    }
  }
}

module.exports = BotManager;
