// Backend URL configuration for Railway deployment
const detectBackendUrl = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) return envUrl;
  
  // If running on Railway, use the backend service URL
  const currentUrl = window.location.origin;
  if (currentUrl.includes('railway.app')) {
    // Try common Railway backend URL patterns
    const possibleUrls = [
      'https://gclegacy-backend.up.railway.app/v1',
      'https://plantakeoff-backend.up.railway.app/v1', 
      'https://web-production-xxxx.up.railway.app/v1', // Replace xxxx with your backend ID
    ];
    
    // For now, use the first one - update this with your actual backend URL
    return possibleUrls[0];
  }
  
  // Development fallback
  return 'http://localhost:3000/v1';
};

const API_BASE_URL = detectBackendUrl();

// Add debug logging to see what URL is being used
console.log('🔗 API Base URL:', API_BASE_URL);

class ApiService {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async authenticate() {
    try {
      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: 'demo-client',
          client_secret: 'demo-secret'
        }),
      });

      if (!response.ok) {
        throw new Error('Authentication failed');
      }

      const data = await response.json();
      this.token = data.access_token;
      return data;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.token) {
      await this.authenticate();
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired, try to re-authenticate
      this.token = null;
      await this.authenticate();
      return this.request(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async uploadFile(file: File, projectId?: string) {
    if (!this.token) {
      await this.authenticate();
    }

    const formData = new FormData();
    formData.append('file', file);
    if (projectId) {
      formData.append('projectId', projectId);
    }

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(error.message || `Upload failed with status ${response.status}`);
    }

    return response.json();
  }

  async createJob(jobData: {
    fileId: string;
    disciplines: string[];
    targets: string[];
    materialsRuleSetId?: string;
    options?: any;
  }) {
    return this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify(jobData),
    });
  }

  async getJobStatus(jobId: string) {
    return this.request(`/jobs/${jobId}`);
  }

  async getTakeoffResults(jobId: string) {
    return this.request(`/takeoff/${jobId}`);
  }

  async getMaterials(jobId: string) {
    return this.request(`/materials/${jobId}`);
  }

  async getArtifacts(jobId: string) {
    return this.request(`/artifacts/${jobId}`);
  }

  async testWebhook(url: string) {
    return this.request('/webhooks/test', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl.replace('/v1', '')}/health`);
      return response.json();
    } catch (error) {
      throw new Error('API health check failed');
    }
  }
}

export const apiService = new ApiService();
