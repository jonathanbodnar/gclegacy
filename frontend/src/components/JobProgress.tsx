import React from 'react';

interface JobProgressProps {
  jobId: string;
  status: 'QUEUED' | 'PROCESSING' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export const JobProgress: React.FC<JobProgressProps> = ({
  jobId,
  status,
  progress,
  error,
  startedAt,
  finishedAt
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'QUEUED': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'PROCESSING': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'CANCELLING': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'COMPLETED': return 'bg-green-100 text-green-800 border-green-200';
      case 'FAILED': return 'bg-red-100 text-red-800 border-red-200';
      case 'CANCELLED': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'QUEUED':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        );
      case 'PROCESSING':
        return (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case 'COMPLETED':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'CANCELLING':
        return (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case 'FAILED':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'CANCELLED':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Analysis Progress</h3>
            <p className="text-sm text-gray-500">Job ID: {jobId}</p>
          </div>
          
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${getStatusColor(status)}`}>
            {getStatusIcon(status)}
            <span className="text-sm font-medium">{status}</span>
          </div>
        </div>

        {/* Progress Bar */}
        {(status === 'PROCESSING' || status === 'CANCELLING') && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span className="font-medium">
                {progress < 20 ? '🔄 Ingesting file...' :
                 progress < 25 ? '📄 Parsing PDF pages...' :
                 progress < 60 ? '🤖 AI analyzing plans...' :
                 progress < 75 ? '📊 Extracting features...' :
                 progress < 80 ? '💾 Saving to database...' :
                 progress < 95 ? '🔧 Applying material rules...' :
                 '✨ Finalizing results...'}
              </span>
              <span className="font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-shimmer"></div>
              </div>
            </div>
            {progress >= 25 && progress < 60 && (
              <div className="mt-2 text-xs text-gray-500 italic">
                Analyzing each page with AI vision... This may take a few minutes for large plans.
              </div>
            )}
          </div>
        )}

        {/* Warning for QUEUED status with error */}
        {status === 'QUEUED' && error && error.includes('Queue not available') && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-yellow-800 mb-1">Job Queue Not Available</h4>
                <p className="text-sm text-yellow-700">
                  This job is queued but won't process automatically because Redis is not configured. 
                  Ask your admin to add a Redis service to Railway for background job processing.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Error Message - Don't show for cancelled jobs (status badge already shows it) */}
        {error && !error.includes('Queue not available') && status !== 'CANCELLED' && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-red-800">Processing Error</h4>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
          {startedAt && (
            <div>
              <span className="font-medium">Started:</span> {new Date(startedAt).toLocaleString()}
            </div>
          )}
          {finishedAt && (
            <div>
              <span className="font-medium">Finished:</span> {new Date(finishedAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Processing Steps (for visual feedback) */}
        {status === 'PROCESSING' && (
          <div className="mt-6 space-y-3">
            <div className="text-sm font-medium text-gray-700 mb-3">Processing Steps:</div>
            {[
              { step: 'File Upload', progress: progress > 10 ? 100 : (progress / 10) * 100 },
              { step: 'Plan Analysis', progress: progress > 20 ? Math.min(100, ((progress - 20) / 60) * 100) : 0 },
              { step: 'Feature Extraction', progress: progress > 80 ? Math.min(100, ((progress - 80) / 15) * 100) : 0 },
              { step: 'Materials Generation', progress: progress > 95 ? 100 : 0 },
            ].map((item, index) => (
              <div key={index} className="flex items-center space-x-3">
                <div className="w-4 h-4 flex items-center justify-center">
                  {item.progress === 100 ? (
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : item.progress > 0 ? (
                    <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  )}
                </div>
                <span className={`text-sm ${item.progress > 0 ? 'text-gray-900' : 'text-gray-500'}`}>
                  {item.step}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
