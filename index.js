#!/usr/bin/env node

require('dotenv').config();
const logger = require('./logger');
const BotManager = require('./bot-manager');

class Application {
  constructor() {
    this.botManager = new BotManager();
    this.shutdownHandlers = [];
    this.isShuttingDown = false;
  }
  
  async start() {
    try {
      logger.startup('Starting Atlantic H2H Transfer Bot Application');
      logger.startup('=============================================');
      
      // Log startup info
      this.logStartupInfo();
      
      // Initialize bot manager
      const initialized = await this.botManager.initialize();
      if (!initialized) {
        logger.error('Failed to initialize bot manager');
        process.exit(1);
      }
      
      // Setup shutdown handlers
      this.setupShutdownHandlers();
      
      // Setup periodic tasks
      this.setupPeriodicTasks();
      
      // Start the bot
      await this.botManager.start();
      
      logger.startup('Application started successfully! 🚀');
      
    } catch (error) {
      logger.error('Failed to start application', error);
      process.exit(1);
    }
  }
  
  logStartupInfo() {
    const envVars = {
      'Node Version': process.version,
      'Platform': process.platform,
      'Arch': process.arch,
      'PID': process.pid,
      'Bot Token Set': !!process.env.TELEGRAM_BOT_TOKEN,
      'Owner ID Set': !!process.env.OWNER_TELEGRAM_ID,
      'API Key Set': !!process.env.ATLANTIC_API_KEY,
      'API URL': process.env.ATLANTIC_BASE_URL || 'https://atlantich2h.com',
      'Min Deposit': process.env.MIN_DEPOSIT || '1000',
      'Max Deposit': process.env.MAX_DEPOSIT || '10000000',
      'Log Level': process.env.LOG_LEVEL || 'info'
    };
    
    logger.startup('Startup Configuration:', envVars);
  }
  
  setupShutdownHandlers() {
    // Handle graceful shutdown
    const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    shutdownSignals.forEach(signal => {
      process.on(signal, async () => {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.warn(`Received ${signal}, shutting down gracefully...`);
        
        // Run shutdown handlers
        for (const handler of this.shutdownHandlers) {
          try {
            await handler();
          } catch (error) {
            logger.error('Error in shutdown handler', error);
          }
        }
        
        // Final shutdown
        setTimeout(() => {
          logger.shutdown('Shutdown complete');
          process.exit(0);
        }, 5000);
      });
    });
    
    // Add bot manager shutdown to handlers
    this.shutdownHandlers.push(async () => {
      await this.botManager.shutdown();
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error, { type: 'fatal' });
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', reason, { promise: promise });
    });
  }
  
  setupPeriodicTasks() {
    // Auto-backup every 24 hours if enabled
    if (process.env.ENABLE_BACKUP === 'true') {
      const backupInterval = parseInt(process.env.BACKUP_INTERVAL_HOURS) || 24;
      const intervalMs = backupInterval * 60 * 60 * 1000;
      
      setInterval(async () => {
        try {
          logger.info('Running scheduled backup...');
          await this.botManager.db.createBackup();
        } catch (error) {
          logger.error('Scheduled backup failed', error);
        }
      }, intervalMs);
      
      logger.info(`Auto-backup scheduled every ${backupInterval} hours`);
    }
    
    // Cleanup user states every hour
    setInterval(() => {
      this.botManager.cleanupUserStates();
    }, 60 * 60 * 1000);
    
    // Log memory usage every 30 minutes
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      logger.debug('Memory usage', {
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
        external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
      });
    }, 30 * 60 * 1000);
    
    // Health check - test API connection every hour
    setInterval(async () => {
      try {
        const apiTest = await this.botManager.apiClient.testConnection();
        if (!apiTest.connected) {
          logger.warn('API connection check failed', {
            message: apiTest.message
          });
        }
      } catch (error) {
        logger.error('API health check failed', error);
      }
    }, 60 * 60 * 1000);
  }
  
  async stop() {
    await this.botManager.stop();
  }
}

// Run application
const app = new Application();

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--test')) {
  // Run API test
  const AtlanticAPIClient = require('./api-client');
  const client = new AtlanticAPIClient(
    process.env.ATLANTIC_API_KEY,
    process.env.ATLANTIC_BASE_URL
  );
  
  client.testConnection().then(result => {
    console.log('API Test Result:', result);
    process.exit(result.connected ? 0 : 1);
  });
} else if (args.includes('--backup')) {
  // Run manual backup
  const DatabaseManager = require('./database-manager');
  const db = new DatabaseManager();
  
  db.initialize().then(async () => {
    const backupFile = await db.createBackup();
    console.log('Backup created:', backupFile);
    process.exit(0);
  }).catch(error => {
    console.error('Backup failed:', error);
    process.exit(1);
  });
} else {
  // Start normally
  app.start().catch(error => {
    logger.error('Application failed to start', error);
    process.exit(1);
  });
}
