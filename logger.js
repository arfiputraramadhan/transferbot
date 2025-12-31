const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');
const { format } = require('winston');

// Pastikan folder logs ada
const logDir = path.join(__dirname, 'logs');
fs.ensureDirSync(logDir);

// Format log yang lebih informatif
const logFormat = format.combine(
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  format.errors({ stack: true }),
  format.splat(),
  format.json(),
  format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] })
);

// Custom format untuk console
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    
    if (Object.keys(metadata).length > 0) {
      // Filter metadata yang penting
      const importantMeta = {};
      if (metadata.metadata) {
        const meta = metadata.metadata;
        if (meta.user_id) importantMeta.user_id = meta.user_id;
        if (meta.transaction_id) importantMeta.transaction_id = meta.transaction_id;
        if (meta.type) importantMeta.type = meta.type;
        if (meta.error_code) importantMeta.error_code = meta.error_code;
      }
      
      if (Object.keys(importantMeta).length > 0) {
        msg += ` | ${JSON.stringify(importantMeta)}`;
      }
    }
    
    return msg;
  })
);

// Transport untuk berbagai jenis log
const transports = [
  // Error log
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 10485760, // 10MB
    maxFiles: 10,
    tailable: true,
    format: logFormat
  }),
  
  // Combined log
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 10485760, // 10MB
    maxFiles: 10,
    tailable: true,
    format: logFormat
  }),
  
  // Bot activity log khusus
  new winston.transports.File({
    filename: path.join(logDir, 'bot-activity.log'),
    maxsize: 10485760,
    maxFiles: 5,
    format: format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.json()
    )
  }),
  
  // API log khusus
  new winston.transports.File({
    filename: path.join(logDir, 'api-calls.log'),
    maxsize: 10485760,
    maxFiles: 5,
    format: logFormat
  })
];

// Selalu log ke console di production juga
transports.push(
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.LOG_LEVEL || 'info'
  })
);

// Buat logger utama
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'atlantic-transfer-bot',
    version: '1.0.0'
  },
  transports: transports,
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'exceptions.log') 
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'rejections.log') 
    })
  ],
  exitOnError: false // Tidak exit saat error logging
});

// Helper functions untuk logging yang lebih spesifik
const botLogger = {
  // Log umum
  info: (message, metadata = {}) => {
    logger.info(message, { metadata: { ...metadata, type: 'bot', timestamp: new Date().toISOString() } });
  },
  
  // Log error dengan detail lengkap
  error: (message, error = null, metadata = {}) => {
    const errorDetails = error ? {
      error_message: error.message,
      error_stack: error.stack,
      error_code: error.code,
      error_name: error.name,
      ...(error.response && {
        api_status: error.response.status,
        api_data: error.response.data,
        api_headers: error.response.headers
      })
    } : {};
    
    logger.error(message, { 
      metadata: { 
        ...metadata, 
        ...errorDetails, 
        type: 'error',
        severity: 'high',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log warning
  warn: (message, metadata = {}) => {
    logger.warn(message, { metadata: { ...metadata, type: 'warning', timestamp: new Date().toISOString() } });
  },
  
  // Log API calls
  api: (message, data = {}, metadata = {}) => {
    logger.info(message, { 
      metadata: { 
        ...metadata, 
        ...data, 
        type: 'api_call',
        endpoint: data.endpoint || 'unknown',
        method: data.method || 'POST',
        duration: data.duration || 0,
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log transaksi
  transaction: (message, transactionData = {}, metadata = {}) => {
    logger.info(message, { 
      metadata: { 
        ...metadata, 
        ...transactionData, 
        type: 'transaction',
        category: transactionData.category || 'transfer',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log aktivitas user
  user: (message, userId, action = '', metadata = {}) => {
    logger.info(message, { 
      metadata: { 
        ...metadata, 
        user_id: userId,
        action: action,
        type: 'user_activity',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log debug
  debug: (message, metadata = {}) => {
    logger.debug(message, { metadata: { ...metadata, type: 'debug', timestamp: new Date().toISOString() } });
  },
  
  // Log command bot
  command: (command, userId, chatId, metadata = {}) => {
    logger.info(`Command: ${command}`, { 
      metadata: { 
        ...metadata,
        command: command,
        user_id: userId,
        chat_id: chatId,
        type: 'bot_command',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log startup
  startup: (message, metadata = {}) => {
    logger.info(message, { 
      metadata: { 
        ...metadata, 
        type: 'system_startup',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log shutdown
  shutdown: (message, metadata = {}) => {
    logger.info(message, { 
      metadata: { 
        ...metadata, 
        type: 'system_shutdown',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log database operations
  database: (operation, data = {}, metadata = {}) => {
    logger.info(`Database ${operation}`, { 
      metadata: { 
        ...metadata, 
        operation: operation,
        ...data,
        type: 'database',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log transfer khusus
  transfer: (action, data = {}, metadata = {}) => {
    logger.info(`Transfer ${action}`, { 
      metadata: { 
        ...metadata, 
        action: action,
        ...data,
        type: 'transfer',
        timestamp: new Date().toISOString() 
      } 
    });
  },
  
  // Log deposit
  deposit: (action, data = {}, metadata = {}) => {
    logger.info(`Deposit ${action}`, { 
      metadata: { 
        ...metadata, 
        action: action,
        ...data,
        type: 'deposit',
        timestamp: new Date().toISOString() 
      } 
    });
  }
};

// Fungsi untuk mendapatkan log terbaru
botLogger.getRecentLogs = async (count = 50, level = 'info') => {
  try {
    const logFile = path.join(logDir, 'combined.log');
    if (!await fs.pathExists(logFile)) {
      return [];
    }
    
    const logs = await fs.readFile(logFile, 'utf8');
    const logLines = logs.trim().split('\n').reverse().slice(0, count);
    
    return logLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
  } catch (error) {
    logger.error('Failed to read logs', error);
    return [];
  }
};

// Fungsi untuk cleanup log lama
botLogger.cleanupOldLogs = async (daysToKeep = 30) => {
  try {
    const files = await fs.readdir(logDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate && file !== 'combined.log' && file !== 'error.log') {
          await fs.unlink(filePath);
          logger.info(`Deleted old log file: ${file}`);
        }
      }
    }
  } catch (error) {
    logger.error('Failed to cleanup old logs', error);
  }
};

module.exports = botLogger;
