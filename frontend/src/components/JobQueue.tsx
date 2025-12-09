import { useState, useEffect, useRef } from "react";
import { apiService } from "../services/api";

interface JobStatus {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "CANCELLING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progress: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface JobQueueProps {
  onJobSelect?: (jobId: string) => void;
}

export function JobQueue({ onJobSelect }: JobQueueProps) {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set());

  // Get user's jobs from localStorage
  const getUserJobs = (): string[] => {
    const savedJobId = localStorage.getItem('currentJobId');
    const jobHistory = localStorage.getItem('jobHistory');
    
    const jobIds = new Set<string>();
    if (savedJobId) jobIds.add(savedJobId);
    
    if (jobHistory) {
      try {
        const history = JSON.parse(jobHistory);
        if (Array.isArray(history)) {
          history.forEach((id: string) => jobIds.add(id));
        }
      } catch (e) {
        console.error('Failed to parse job history:', e);
      }
    }
    
    return Array.from(jobIds);
  };

  // Fetch job statuses
  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const jobIds = getUserJobs();
      if (jobIds.length === 0) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const jobPromises = jobIds.map(async (jobId) => {
        try {
          const status = await apiService.getJobStatus(jobId);
          return {
            jobId,
            ...status,
          };
        } catch (err: any) {
          // Job might not exist anymore - skip it
          console.warn(`Job ${jobId} not found:`, err.message);
          return null;
        }
      });

      const results = await Promise.all(jobPromises);
      const validJobs = results.filter((job): job is JobStatus => job !== null);
      
      // Sort by status priority (active jobs first), then by time
      validJobs.sort((a, b) => {
        // Status priority: PROCESSING > CANCELLING > QUEUED > COMPLETED > others
        const statusPriority: Record<string, number> = {
          'PROCESSING': 4,
          'CANCELLING': 3,
          'QUEUED': 2,
          'COMPLETED': 1,
          'FAILED': 0,
          'CANCELLED': 0,
        };
        const aPriority = statusPriority[a.status] || 0;
        const bPriority = statusPriority[b.status] || 0;
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        // Then by time (most recent first)
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : (a.finishedAt ? new Date(a.finishedAt).getTime() : 0);
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : (b.finishedAt ? new Date(b.finishedAt).getTime() : 0);
        return bTime - aTime;
      });

      setJobs(validJobs);
    } catch (err: any) {
      setError(err.message || "Failed to fetch jobs");
      console.error("Error fetching jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  // Cancel a job
  const handleCancel = async (jobId: string) => {
    if (cancellingJobs.has(jobId)) return; // Already cancelling
    
    setCancellingJobs((prev) => new Set(prev).add(jobId));
    
    try {
      await apiService.cancelJob(jobId);
      // Refresh jobs to show CANCELLING status
      await fetchJobs();
    } catch (err: any) {
      setError(err.message || "Failed to cancel job");
      console.error("Error cancelling job:", err);
    } finally {
      // Keep it in cancelling set for a bit to show CANCELLING status
      setTimeout(() => {
        setCancellingJobs((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }, 2000);
    }
  };

  // Clear all processed jobs (FAILED, COMPLETED, CANCELLED) from localStorage
  const handleClearProcessedJobs = async () => {
    try {
      // Get all current jobs
      const processedStatuses = ['FAILED', 'COMPLETED', 'CANCELLED'];
      const processedJobIds = jobs
        .filter(job => processedStatuses.includes(job.status))
        .map(job => job.jobId);

      if (processedJobIds.length === 0) {
        setError("No processed jobs to clear");
        return;
      }

      // Remove from localStorage
      const currentJobId = localStorage.getItem('currentJobId');
      const jobHistory = localStorage.getItem('jobHistory');

      // Remove from currentJobId if it's a processed job
      if (currentJobId && processedJobIds.includes(currentJobId)) {
        localStorage.removeItem('currentJobId');
      }

      // Remove from jobHistory
      if (jobHistory) {
        try {
          const history = JSON.parse(jobHistory);
          if (Array.isArray(history)) {
            const filteredHistory = history.filter(
              (id: string) => !processedJobIds.includes(id)
            );
            if (filteredHistory.length > 0) {
              localStorage.setItem('jobHistory', JSON.stringify(filteredHistory));
            } else {
              localStorage.removeItem('jobHistory');
            }
          }
        } catch (e) {
          console.error('Failed to parse job history:', e);
        }
      }

      // Refresh the job list
      await fetchJobs();
    } catch (err: any) {
      setError(err.message || "Failed to clear processed jobs");
      console.error("Error clearing processed jobs:", err);
    }
  };

  // Smart polling: only poll when there are active jobs
  const jobsRef = useRef(jobs);
  
  // Update ref when jobs change
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    fetchJobs();
    
    const interval = setInterval(() => {
      // Check current jobs state for active jobs
      const hasActiveJobs = jobsRef.current.some(
        job => job.status === "QUEUED" || 
               job.status === "PROCESSING" || 
               job.status === "CANCELLING"
      );
      
      // Only poll if there are active jobs
      if (hasActiveJobs) {
        fetchJobs();
      }
    }, 3000); // Poll every 3 seconds when there are active jobs

    return () => clearInterval(interval);
  }, []); // Only set up once on mount

  const getStatusColor = (status: string) => {
    switch (status) {
      case "QUEUED":
        return "bg-yellow-100 text-yellow-800";
      case "PROCESSING":
        return "bg-blue-100 text-blue-800";
      case "CANCELLING":
        return "bg-orange-100 text-orange-800";
      case "COMPLETED":
        return "bg-green-100 text-green-800";
      case "FAILED":
        return "bg-red-100 text-red-800";
      case "CANCELLED":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusLabel = (job: JobStatus) => {
    // Show CANCELLING if we're in the process of cancelling
    if (cancellingJobs.has(job.jobId) && job.status !== "CANCELLED") {
      return "CANCELLING";
    }
    return job.status;
  };

  const canCancel = (status: string) => {
    return status === "QUEUED" || status === "PROCESSING";
  };

  // Count processed jobs
  const processedJobsCount = jobs.filter(
    job => ['FAILED', 'COMPLETED', 'CANCELLED'].includes(job.status)
  ).length;

  if (loading && jobs.length === 0) {
    return (
      <div>
        <p className="text-gray-500">Loading jobs...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div>
        <p className="text-gray-500">No jobs found. Start a new analysis to see jobs here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        {processedJobsCount > 0 && (
          <button
            onClick={handleClearProcessedJobs}
            className="text-sm px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Clear All Processed ({processedJobsCount})
          </button>
        )}
        <button
          onClick={fetchJobs}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const displayStatus = getStatusLabel(job);
          const isCancelling = cancellingJobs.has(job.jobId) && job.status !== "CANCELLED";
          
          return (
            <div
              key={job.jobId}
              className="border rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => onJobSelect?.(job.jobId)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-mono text-gray-600">
                      {job.jobId.slice(0, 8)}...
                    </span>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(displayStatus)}`}
                    >
                      {displayStatus}
                    </span>
                  </div>

                  {(displayStatus === "PROCESSING" || displayStatus === "CANCELLING") && (
                    <div className="mb-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{job.progress}%</p>
                    </div>
                  )}

                  {job.error && (
                    <p className="text-sm text-red-600 mt-1">{job.error}</p>
                  )}

                  {job.startedAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      Started: {new Date(job.startedAt).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 ml-4">
                  {canCancel(job.status) && !isCancelling && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancel(job.jobId);
                      }}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  {isCancelling && (
                    <span className="px-3 py-1 text-sm bg-orange-100 text-orange-800 rounded">
                      Cancelling...
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
