const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, 'database.json');
    this.backupDir = path.join(__dirname, 'backups');
    this.data = null;
    this.isLoaded = false;
    this.isSaving = false;
    this.saveQueue = [];
    this.lock = false;
  }

  // Struktur database default
  getDefaultStructure() {
    return {
      users: [],
      transactions: [],
      deposits: [],
      settings: {
        owner_id: process.env.OWNER_TELEGRAM_ID || '',
        min_deposit: parseInt(process.env.MIN_DEPOSIT) || 1000,
        max_deposit: parseInt(process.env.MAX_DEPOSIT) || 10000000,
        fee_percentage: parseFloat(process.env.DEFAULT_FEE_PERCENTAGE) || 0.1,
        api_key: process.env.ATLANTIC_API_KEY || '',
        auto_retry: true,
        max_retry: 3,
        enable_logging: true,
        notification_enabled: true
      },
      system: {
        last_startup: new Date().toISOString(),
        total_requests: 0,
        failed_requests: 0,
        successful_transfers: 0,
        successful_deposits: 0,
        total_volume: 0,
        last_backup: null,
        last_cleanup: null
      }
    };
  }

  async initialize() {
    try {
      // Buat direktori backup jika belum ada
      await fs.ensureDir(this.backupDir);
      
      // Load database
      if (await fs.pathExists(this.dbPath)) {
        const rawData = await fs.readFile(this.dbPath, 'utf8');
        this.data = JSON.parse(rawData);
        
        // Update struktur jika ada field baru
        this.data = this.migrateDatabase(this.data);
        
        logger.database('loaded', {
          users_count: this.data.users.length,
          transactions_count: this.data.transactions.length,
          deposits_count: this.data.deposits.length,
          file_size: (Buffer.byteLength(rawData, 'utf8') / 1024).toFixed(2) + 'KB'
        });
      } else {
        this.data = this.getDefaultStructure();
        await this.save();
        logger.database('created', { reason: 'new_database' });
      }
      
      this.isLoaded = true;
      logger.startup('Database initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize database', error, {
        operation: 'initialize',
        db_path: this.dbPath
      });
      
      // Fallback ke database default
      this.data = this.getDefaultStructure();
      this.isLoaded = true;
      return false;
    }
  }

  // Migrasi database untuk kompatibilitas
  migrateDatabase(oldData) {
    const defaultData = this.getDefaultStructure();
    
    // Pastikan semua field ada
    if (!oldData.users) oldData.users = [];
    if (!oldData.transactions) oldData.transactions = [];
    if (!oldData.deposits) oldData.deposits = [];
    
    // Migrasi settings
    if (!oldData.settings) oldData.settings = {};
    for (const [key, value] of Object.entries(defaultData.settings)) {
      if (oldData.settings[key] === undefined) {
        oldData.settings[key] = value;
      }
    }
    
    // Migrasi system
    if (!oldData.system) oldData.system = {};
    for (const [key, value] of Object.entries(defaultData.system)) {
      if (oldData.system[key] === undefined) {
        oldData.system[key] = value;
      }
    }
    
    // Update min_deposit jika belum ada
    if (!oldData.settings.min_deposit) {
      oldData.settings.min_deposit = 1000;
    }
    
    return oldData;
  }

  // Save database dengan queue system
  async save() {
    if (this.lock) {
      // Jika sedang disave, queue dulu
      return new Promise((resolve) => {
        this.saveQueue.push(resolve);
      });
    }
    
    this.lock = true;
    
    try {
      // Buat backup sebelum save
      await this.createBackup();
      
      // Save database
      await fs.writeJson(this.dbPath, this.data, { spaces: 2 });
      
      logger.database('saved', {
        queue_length: this.saveQueue.length,
        timestamp: new Date().toISOString()
      });
      
      // Update last backup time
      this.data.system.last_backup = new Date().toISOString();
      
      return true;
    } catch (error) {
      logger.error('Failed to save database', error, {
        operation: 'save',
        queue_length: this.saveQueue.length
      });
      return false;
    } finally {
      this.lock = false;
      
      // Proses queue jika ada
      if (this.saveQueue.length > 0) {
        const nextResolve = this.saveQueue.shift();
        nextResolve();
      }
    }
  }

  // Create backup
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `backup-${timestamp}.json`);
      
      await fs.writeJson(backupFile, this.data, { spaces: 2 });
      
      // Hapus backup lama (simpan hanya 7 backup terakhir)
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (backupFiles.length > 7) {
        const filesToDelete = backupFiles.slice(7);
        for (const file of filesToDelete) {
          await fs.unlink(path.join(this.backupDir, file));
        }
        logger.database('backup_cleaned', {
          deleted_count: filesToDelete.length,
          remaining_count: 7
        });
      }
      
      logger.database('backup_created', {
        backup_file: backupFile,
        backup_size: (JSON.stringify(this.data).length / 1024).toFixed(2) + 'KB'
      });
      
      return backupFile;
    } catch (error) {
      logger.error('Failed to create backup', error, { operation: 'backup' });
      return null;
    }
  }

  // Restore dari backup
  async restoreFromBackup(backupFile) {
    try {
      const backupPath = path.join(this.backupDir, backupFile);
      if (!await fs.pathExists(backupPath)) {
        throw new Error('Backup file not found');
      }
      
      const backupData = await fs.readJson(backupPath);
      this.data = backupData;
      await this.save();
      
      logger.database('restored', { backup_file: backupFile });
      return true;
    } catch (error) {
      logger.error('Failed to restore from backup', error, {
        operation: 'restore',
        backup_file: backupFile
      });
      return false;
    }
  }

  // Get all backups
  async getBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      return files
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();
    } catch (error) {
      logger.error('Failed to get backups', error);
      return [];
    }
  }

  // Tambah user
  addUser(user) {
    if (!this.isLoaded) return false;
    
    const existingUser = this.data.users.find(u => u.id === user.id);
    if (!existingUser) {
      user.created_at = new Date().toISOString();
      user.last_active = new Date().toISOString();
      this.data.users.push(user);
      
      logger.user('New user added', user.id, 'registration', {
        username: user.username,
        first_name: user.first_name
      });
      
      this.save();
      return true;
    }
    
    // Update last active
    existingUser.last_active = new Date().toISOString();
    this.save();
    return true;
  }

  // Tambah transaksi
  addTransaction(transaction) {
    if (!this.isLoaded) return null;
    
    const tx = {
      id: transaction.id || uuidv4(),
      reff_id: transaction.reff_id || `TRF-${Date.now()}`,
      user_id: transaction.user_id,
      type: transaction.type || 'transfer',
      bank_code: transaction.bank_code,
      account_number: transaction.account_number,
      account_name: transaction.account_name,
      nominal: transaction.nominal,
      fee: transaction.fee || 0,
      total: transaction.total || transaction.nominal,
      status: transaction.status || 'pending',
      category: transaction.category || 'withdrawal',
      note: transaction.note || '',
      metadata: transaction.metadata || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    this.data.transactions.push(tx);
    
    // Update system stats
    if (tx.status === 'success') {
      this.data.system.successful_transfers++;
      this.data.system.total_volume += tx.nominal;
    }
    
    this.save();
    
    logger.transaction('Transaction added', {
      transaction_id: tx.id,
      reff_id: tx.reff_id,
      user_id: tx.user_id,
      type: tx.type,
      nominal: tx.nominal,
      status: tx.status,
      category: tx.category
    });
    
    return tx;
  }

  // Tambah deposit
  addDeposit(deposit) {
    if (!this.isLoaded) return null;
    
    const dep = {
      id: deposit.id || uuidv4(),
      reff_id: deposit.reff_id || `DEP-${Date.now()}`,
      user_id: deposit.user_id,
      type: deposit.type || 'deposit',
      method: deposit.method || 'unknown',
      nominal: deposit.nominal,
      fee: deposit.fee || 0,
      total: deposit.total || deposit.nominal,
      status: deposit.status || 'pending',
      proof_url: deposit.proof_url || '',
      note: deposit.note || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    this.data.deposits.push(dep);
    
    // Update system stats
    if (dep.status === 'success') {
      this.data.system.successful_deposits++;
      this.data.system.total_volume += dep.nominal;
    }
    
    this.save();
    
    logger.deposit('Deposit added', {
      deposit_id: dep.id,
      reff_id: dep.reff_id,
      user_id: dep.user_id,
      method: dep.method,
      nominal: dep.nominal,
      status: dep.status
    });
    
    return dep;
  }

  // Update transaction status
  updateTransactionStatus(transactionId, status, metadata = {}) {
    if (!this.isLoaded) return false;
    
    const transaction = this.data.transactions.find(t => t.id === transactionId || t.reff_id === transactionId);
    if (transaction) {
      const oldStatus = transaction.status;
      transaction.status = status;
      transaction.updated_at = new Date().toISOString();
      
      if (metadata) {
        transaction.metadata = { ...transaction.metadata, ...metadata };
      }
      
      // Update system stats
      if (oldStatus !== 'success' && status === 'success') {
        this.data.system.successful_transfers++;
        this.data.system.total_volume += transaction.nominal;
      }
      
      this.save();
      
      logger.transaction('Transaction status updated', {
        transaction_id: transactionId,
        old_status: oldStatus,
        new_status: status,
        user_id: transaction.user_id,
        nominal: transaction.nominal
      });
      
      return true;
    }
    
    return false;
  }

  // Update deposit status
  updateDepositStatus(depositId, status, metadata = {}) {
    if (!this.isLoaded) return false;
    
    const deposit = this.data.deposits.find(d => d.id === depositId || d.reff_id === depositId);
    if (deposit) {
      const oldStatus = deposit.status;
      deposit.status = status;
      deposit.updated_at = new Date().toISOString();
      
      if (metadata) {
        deposit.metadata = { ...deposit.metadata, ...metadata };
      }
      
      // Update system stats
      if (oldStatus !== 'success' && status === 'success') {
        this.data.system.successful_deposits++;
        this.data.system.total_volume += deposit.nominal;
      }
      
      this.save();
      
      logger.deposit('Deposit status updated', {
        deposit_id: depositId,
        old_status: oldStatus,
        new_status: status,
        user_id: deposit.user_id,
        nominal: deposit.nominal
      });
      
      return true;
    }
    
    return false;
  }

  // Get user transactions
  getUserTransactions(userId, limit = 10) {
    if (!this.isLoaded) return [];
    
    return this.data.transactions
      .filter(t => t.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  // Get user deposits
  getUserDeposits(userId, limit = 10) {
    if (!this.isLoaded) return [];
    
    return this.data.deposits
      .filter(d => d.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  // Get transaction by ID
  getTransactionById(transactionId) {
    if (!this.isLoaded) return null;
    
    return this.data.transactions.find(t => 
      t.id === transactionId || t.reff_id === transactionId
    );
  }

  // Get deposit by ID
  getDepositById(depositId) {
    if (!this.isLoaded) return null;
    
    return this.data.deposits.find(d => 
      d.id === depositId || d.reff_id === depositId
    );
  }

  // Get system stats
  getSystemStats() {
    if (!this.isLoaded) return null;
    
    return {
      ...this.data.system,
      total_users: this.data.users.length,
      total_transactions: this.data.transactions.length,
      total_deposits: this.data.deposits.length,
      pending_transactions: this.data.transactions.filter(t => t.status === 'pending').length,
      pending_deposits: this.data.deposits.filter(d => d.status === 'pending').length
    };
  }

  // Cleanup old data (opsional)
  async cleanupOldData(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      // Cleanup transactions
      const oldTransactions = this.data.transactions.filter(
        t => new Date(t.created_at) < cutoffDate && t.status === 'success'
      );
      
      // Cleanup deposits
      const oldDeposits = this.data.deposits.filter(
        d => new Date(d.created_at) < cutoffDate && d.status === 'success'
      );
      
      // Untuk sekarang, kita hanya log saja
      logger.database('cleanup_check', {
        old_transactions: oldTransactions.length,
        old_deposits: oldDeposits.length,
        cutoff_date: cutoffDate.toISOString()
      });
      
      this.data.system.last_cleanup = new Date().toISOString();
      await this.save();
      
      return {
        old_transactions: oldTransactions.length,
        old_deposits: oldDeposits.length
      };
    } catch (error) {
      logger.error('Failed to cleanup old data', error);
      return null;
    }
  }

  // Export data (untuk backup manual)
  async exportData() {
    if (!this.isLoaded) return null;
    
    try {
      const exportData = {
        export_date: new Date().toISOString(),
        users: this.data.users,
        transactions: this.data.transactions,
        deposits: this.data.deposits,
        settings: this.data.settings,
        system: this.data.system
      };
      
      const exportFile = path.join(this.backupDir, `export-${Date.now()}.json`);
      await fs.writeJson(exportFile, exportData, { spaces: 2 });
      
      logger.database('data_exported', { export_file: exportFile });
      return exportFile;
    } catch (error) {
      logger.error('Failed to export data', error);
      return null;
    }
  }
}

module.exports = DatabaseManager;
