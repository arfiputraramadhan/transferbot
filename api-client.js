const axios = require('axios');
const logger = require('./logger');
const FormData = require('form-data');

class AtlanticAPIClient {
  constructor(apiKey, baseURL = 'https://atlantich2h.com') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.maxRetries = parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3;
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Atlantic-H2H-Bot/1.0.0'
      }
    });
    
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const startTime = Date.now();
        config.metadata = { startTime };
        
        logger.api('API Request started', {
          endpoint: config.url,
          method: config.method,
          params: config.params,
          data: config.data
        });
        
        return config;
      },
      (error) => {
        logger.error('API Request preparation failed', error);
        return Promise.reject(error);
      }
    );
    
    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const endTime = Date.now();
        const duration = endTime - response.config.metadata.startTime;
        
        logger.api('API Response received', {
          endpoint: response.config.url,
          method: response.config.method,
          status: response.status,
          duration: duration,
          data: response.data
        });
        
        return response;
      },
      async (error) => {
        const endTime = Date.now();
        const duration = endTime - (error.config?.metadata?.startTime || endTime);
        
        logger.error('API Request failed', error, {
          endpoint: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          duration: duration,
          retry_count: error.config?.retryCount || 0
        });
        
        // Implement retry logic
        if (this.shouldRetry(error) && (error.config?.retryCount || 0) < this.maxRetries) {
          return this.retryRequest(error.config);
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  shouldRetry(error) {
    // Retry pada error tertentu
    if (!error.config) return false;
    
    const status = error.response?.status;
    const errorCode = error.code;
    
    // Retry pada:
    // 1. Network errors
    // 2. Timeout errors
    // 3. 5xx server errors
    // 4. 429 rate limit
    return (
      errorCode === 'ECONNABORTED' ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT' ||
      status === 429 ||
      status >= 500
    );
  }
  
  async retryRequest(config) {
    const retryCount = (config.retryCount || 0) + 1;
    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff
    
    logger.warn(`Retrying request (attempt ${retryCount}/${this.maxRetries})`, {
      endpoint: config.url,
      delay: delay,
      previous_error: config.previousError
    });
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return this.axiosInstance({
      ...config,
      retryCount: retryCount,
      previousError: config.previousError || 'unknown'
    });
  }
  
  // Helper untuk membuat form data
  createFormData(data) {
    const formData = new FormData();
    
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    }
    
    return formData;
  }
  
  // Get bank list
  async getBankList() {
    try {
      const startTime = Date.now();
      
      const response = await this.axiosInstance.post('/transfer/bank_list', {
        api_key: this.apiKey
      });
      
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.status) {
        logger.api('Bank list retrieved successfully', {
          endpoint: '/transfer/bank_list',
          duration: duration,
          count: response.data.data?.length || 0
        });
        
        return {
          success: true,
          data: response.data.data || [],
          message: response.data.message || 'Success'
        };
      } else {
        logger.warn('Bank list API returned non-success status', {
          endpoint: '/transfer/bank_list',
          response_data: response.data
        });
        
        return {
          success: false,
          data: [],
          message: response.data?.message || 'Failed to get bank list'
        };
      }
    } catch (error) {
      logger.error('Failed to get bank list', error, {
        endpoint: '/transfer/bank_list',
        operation: 'get_bank_list'
      });
      
      return {
        success: false,
        data: [],
        message: this.getErrorMessage(error)
      };
    }
  }
  
  // Check account
  async checkAccount(bankCode, accountNumber) {
    try {
      const startTime = Date.now();
      
      const response = await this.axiosInstance.post('/transfer/cek_rekening', {
        api_key: this.apiKey,
        bank_code: bankCode,
        account_number: accountNumber
      });
      
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.status) {
        logger.api('Account check successful', {
          endpoint: '/transfer/cek_rekening',
          duration: duration,
          bank_code: bankCode,
          account_number: accountNumber,
          status: response.data.data?.status
        });
        
        return {
          success: true,
          data: response.data.data || {},
          message: response.data.message || 'Success'
        };
      } else {
        logger.warn('Account check returned non-success status', {
          endpoint: '/transfer/cek_rekening',
          bank_code: bankCode,
          account_number: accountNumber,
          response_data: response.data
        });
        
        return {
          success: false,
          data: null,
          message: response.data?.message || 'Account check failed'
        };
      }
    } catch (error) {
      logger.error('Failed to check account', error, {
        endpoint: '/transfer/cek_rekening',
        bank_code: bankCode,
        account_number: accountNumber
      });
      
      return {
        success: false,
        data: null,
        message: this.getErrorMessage(error)
      };
    }
  }
  
  // Create transfer
  async createTransfer(transferData) {
    try {
      const startTime = Date.now();
      
      // Validasi data
      if (!transferData.kode_bank || !transferData.nomor_akun || !transferData.nominal) {
        throw new Error('Missing required transfer data');
      }
      
      const requestData = {
        api_key: this.apiKey,
        ref_id: transferData.ref_id || `TRF-${Date.now()}`,
        kode_bank: transferData.kode_bank,
        nomor_akun: transferData.nomor_akun,
        nama_pemilik: transferData.nama_pemilik || '',
        nominal: transferData.nominal,
        email: transferData.email || '',
        phone: transferData.phone || '',
        note: transferData.note || ''
      };
      
      const response = await this.axiosInstance.post('/transfer/create', requestData);
      
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.status) {
        logger.transfer('Transfer created successfully', {
          endpoint: '/transfer/create',
          duration: duration,
          ref_id: requestData.ref_id,
          bank_code: transferData.kode_bank,
          account_number: transferData.nomor_akun,
          nominal: transferData.nominal,
          transfer_id: response.data.data?.id
        });
        
        return {
          success: true,
          data: response.data.data || {},
          message: response.data.message || 'Transfer created successfully'
        };
      } else {
        logger.warn('Transfer creation returned non-success status', {
          endpoint: '/transfer/create',
          ref_id: requestData.ref_id,
          response_data: response.data
        });
        
        return {
          success: false,
          data: null,
          message: response.data?.message || 'Transfer creation failed'
        };
      }
    } catch (error) {
      logger.error('Failed to create transfer', error, {
        endpoint: '/transfer/create',
        transfer_data: transferData
      });
      
      return {
        success: false,
        data: null,
        message: this.getErrorMessage(error)
      };
    }
  }
  
  // Check transfer status
  async checkTransferStatus(transactionId) {
    try {
      const startTime = Date.now();
      
      const response = await this.axiosInstance.post('/transfer/status', {
        api_key: this.apiKey,
        id: transactionId
      });
      
      const duration = Date.now() - startTime;
      
      if (response.data) {
        logger.api('Transfer status checked', {
          endpoint: '/transfer/status',
          duration: duration,
          transaction_id: transactionId,
          status: response.data.data?.status
        });
        
        return {
          success: true,
          data: response.data.data || {},
          message: response.data.message || 'Status retrieved'
        };
      } else {
        logger.warn('Transfer status check returned no data', {
          endpoint: '/transfer/status',
          transaction_id: transactionId
        });
        
        return {
          success: false,
          data: null,
          message: 'No data returned'
        };
      }
    } catch (error) {
      logger.error('Failed to check transfer status', error, {
        endpoint: '/transfer/status',
        transaction_id: transactionId
      });
      
      return {
        success: false,
        data: null,
        message: this.getErrorMessage(error)
      };
    }
  }
  
  // Helper untuk mendapatkan error message
  getErrorMessage(error) {
    if (error.response) {
      // Server responded with error
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) return 'API Key tidak valid';
      if (status === 403) return 'Akses ditolak';
      if (status === 404) return 'Endpoint tidak ditemukan';
      if (status === 429) return 'Terlalu banyak permintaan, coba lagi nanti';
      if (status >= 500) return 'Server error, coba lagi nanti';
      
      return data?.message || `HTTP Error ${status}`;
    } else if (error.request) {
      // Request made but no response
      if (error.code === 'ECONNABORTED') return 'Timeout, koneksi terputus';
      if (error.code === 'ECONNRESET') return 'Koneksi direset oleh server';
      if (error.code === 'ETIMEDOUT') return 'Koneksi timeout';
      
      return 'Tidak ada response dari server, cek koneksi internet';
    } else {
      // Error in request setup
      return error.message || 'Unknown error occurred';
    }
  }
  
  // Test API connection
  async testConnection() {
    try {
      logger.info('Testing API connection...');
      
      const result = await this.getBankList();
      
      if (result.success) {
        logger.startup('API Connection test successful', {
          bank_count: result.data.length,
          api_url: this.baseURL
        });
        
        return {
          connected: true,
          message: `Connected successfully. Found ${result.data.length} banks/ewallets`,
          data: result.data.slice(0, 5) // Return first 5 for info
        };
      } else {
        logger.error('API Connection test failed', null, {
          reason: result.message
        });
        
        return {
          connected: false,
          message: result.message,
          data: []
        };
      }
    } catch (error) {
      logger.error('API Connection test threw exception', error);
      
      return {
        connected: false,
        message: this.getErrorMessage(error),
        data: []
      };
    }
  }
}

module.exports = AtlanticAPIClient;
