import React, { useState, useEffect } from "react";
import { PlanUpload } from "./components/PlanUpload";
import { JobConfiguration } from "./components/JobConfiguration";
import { JobProgress } from "./components/JobProgress";
import { TakeoffResults } from "./components/TakeoffResults";
import { JobQueue } from "./components/JobQueue";
import { apiService } from "./services/api";
import "./App.css";

type AppStep = "upload" | "configure" | "processing" | "results";

interface JobConfig {
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options: {
    bimPreferred: boolean;
    inferScale: boolean;
  };
}

function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobConfig, setJobConfig] = useState<JobConfig>({
    disciplines: ["A", "P", "M", "E"],
    targets: ["rooms", "walls", "doors", "windows", "pipes", "ducts", "fixtures"],
    options: { bimPreferred: true, inferScale: true },
  });
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [takeoffData, setTakeoffData] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiHealth, setApiHealth] = useState<any>(null);
  const [showJobQueueModal, setShowJobQueueModal] = useState(false);

  useEffect(() => {
    // Check API health on startup
    checkApiHealth();
    
    // Restore job state from localStorage on page load
    const savedJobId = localStorage.getItem('currentJobId');
    const savedFileId = localStorage.getItem('currentFileId');
    const savedStep = localStorage.getItem('currentStep') as AppStep;
    
    if (savedJobId) {
      setJobId(savedJobId);
      if (savedFileId) setFileId(savedFileId);
      if (savedStep) setCurrentStep(savedStep);
      
      // If we have a job ID, fetch its current status immediately
      if (savedStep === 'processing' || savedStep === 'results') {
        console.log('Restored job from localStorage:', savedJobId);
        
        // Fetch job status immediately
        apiService.getJobStatus(savedJobId)
          .then(status => {
            console.log('Restored job status:', status);
            setJobStatus(status);
            
            // If job is completed, load results and move to results step
            if (status.status === 'COMPLETED') {
              setCurrentStep('results');
              apiService.getTakeoffResults(savedJobId)
                .then(results => setTakeoffData(results))
                .catch(err => console.error('Failed to load results:', err));
            }
          })
          .catch(err => {
            console.error('Failed to load job status:', err);
            // If job not found or auth failed, clear localStorage and reset
            console.log('Clearing localStorage due to error');
            localStorage.removeItem('currentJobId');
            localStorage.removeItem('currentFileId');
            localStorage.removeItem('currentStep');
            setJobId(null);
            setFileId(null);
            setCurrentStep('upload');
            setError('Failed to restore previous job. Please start a new analysis.');
          });
      }
    }
  }, []);

  useEffect(() => {
    // Poll job status when processing
    if (jobId && currentStep === "processing") {
      let failureCount = 0;
      const MAX_FAILURES = 3;
      
      const pollInterval = setInterval(async () => {
        try {
          const status = await apiService.getJobStatus(jobId);
          setJobStatus(status);
          failureCount = 0; // Reset on success

          if (status.status === "COMPLETED") {
            clearInterval(pollInterval);
            await loadResults();
            setCurrentStep("results");
            localStorage.setItem('currentStep', 'results');
          } else if (status.status === "FAILED") {
            clearInterval(pollInterval);
            setError(status.error || "Job processing failed");
            // Keep in localStorage so user can see the error after refresh
          } else if (status.status === "CANCELLED") {
            // Job was cancelled - stop polling
            clearInterval(pollInterval);
            // Clear any error message - status badge already shows "CANCELLED"
            setError(null);
          } else if (status.status === "CANCELLING") {
            // Job is being cancelled - keep polling until it becomes CANCELLED
            // Don't stop polling yet, just update the status
            setJobStatus(status);
          }
        } catch (error) {
          console.error("Error polling job status:", error);
          failureCount++;
          
          // After 3 consecutive failures, assume job doesn't exist and reset
          if (failureCount >= MAX_FAILURES) {
            console.log(`Failed to poll job status ${MAX_FAILURES} times, resetting...`);
            clearInterval(pollInterval);
            localStorage.clear();
            setCurrentStep('upload');
            setJobId(null);
            setJobStatus(null);
            setError('Lost connection to job. Please start a new analysis.');
          }
        }
      }, 5000); // Poll every 5 seconds

      return () => clearInterval(pollInterval);
    }
  }, [jobId, currentStep]);
  
  // Sync step changes to localStorage
  useEffect(() => {
    if (currentStep && jobId) {
      localStorage.setItem('currentStep', currentStep);
    }
  }, [currentStep, jobId]);

  const checkApiHealth = async () => {
    try {
      const health = await apiService.checkHealth();
      setApiHealth(health);
    } catch (error) {
      console.error("API health check failed:", error);
      setApiHealth({ status: "error", message: "API not available" });
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      const response = await apiService.uploadFile(file);
      setUploadedFile(file);
      setFileId(response.fileId);
      setCurrentStep("configure");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!fileId) return;
    
    // Prevent double-clicking - disable button if already starting
    if (isStartingAnalysis || currentStep === "processing") {
      return;
    }

    setIsStartingAnalysis(true);
    setError(null);
    let jobCreated = false;

    try {
      const response = await apiService.createJob({
        fileId,
        disciplines: jobConfig.disciplines,
        targets: jobConfig.targets,
        options: jobConfig.options,
      });

      jobCreated = true;
      setJobId(response.jobId);
      setCurrentStep("processing");
      
      // Persist to localStorage so we can resume after refresh
      localStorage.setItem('currentJobId', response.jobId);
      localStorage.setItem('currentFileId', fileId);
      localStorage.setItem('currentStep', 'processing');
      
      // Add to job history
      const jobHistory = JSON.parse(localStorage.getItem('jobHistory') || '[]');
      if (!jobHistory.includes(response.jobId)) {
        jobHistory.push(response.jobId);
        // Keep only last 50 jobs
        if (jobHistory.length > 50) {
          jobHistory.shift();
        }
        localStorage.setItem('jobHistory', JSON.stringify(jobHistory));
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to start analysis"
      );
      // Reset on error so user can retry
      setIsStartingAnalysis(false);
    } finally {
      // Reset after a short delay to prevent rapid clicking
      // But keep disabled if we successfully started processing
      if (!jobCreated) {
        setTimeout(() => setIsStartingAnalysis(false), 500);
      } else {
        setIsStartingAnalysis(false);
      }
    }
  };

  const loadResults = async (jobIdToLoad?: string) => {
    const targetJobId = jobIdToLoad || jobId;
    if (!targetJobId) return;

    try {
      const results = await apiService.getTakeoffResults(targetJobId);
      setTakeoffData(results);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load results"
      );
    }
  };

  const handleExport = async (format: "json" | "csv") => {
    if (!takeoffData) return;

    const dataStr =
      format === "json"
        ? JSON.stringify(takeoffData, null, 2)
        : convertToCSV(takeoffData);

    const blob = new Blob([dataStr], {
      type: format === "json" ? "application/json" : "text/csv",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `takeoff-results.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const convertToCSV = (data: any): string => {
    // Simple CSV conversion for rooms
    const headers = ["Type", "ID", "Name", "Value", "Unit"];
    const rows: string[][] = [];

    data.rooms?.forEach((room: any) => {
      rows.push([
        "Room",
        room.id,
        room.name || "",
        room.area.toString(),
        data.units.area,
      ]);
    });

    data.walls?.forEach((wall: any) => {
      rows.push([
        "Wall",
        wall.id,
        wall.partitionType || "",
        wall.length.toString(),
        data.units.linear,
      ]);
    });

    return [headers, ...rows].map((row) => row.join(",")).join("\n");
  };

  const resetApp = () => {
    setCurrentStep("upload");
    setUploadedFile(null);
    setFileId(null);
    setJobId(null);
    setJobStatus(null);
    setTakeoffData(null);
    setError(null);
    
    // Clear localStorage
    localStorage.removeItem('currentJobId');
    localStorage.removeItem('currentFileId');
    localStorage.removeItem('currentStep');
  };

  const renderStepIndicator = () => {
    const steps = [
      { id: "upload", label: "Upload", icon: "📁" },
      { id: "configure", label: "Configure", icon: "⚙️" },
      { id: "processing", label: "Processing", icon: "🔄" },
      { id: "results", label: "Results", icon: "📊" },
    ];

    return (
      <div className="flex justify-center mb-8">
        <div className="flex items-center space-x-4">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                className={`
                flex items-center space-x-2 px-4 py-2 rounded-lg
                ${
                  currentStep === step.id
                    ? "bg-blue-100 text-blue-800 border-2 border-blue-300"
                    : "bg-gray-100 text-gray-600"
                }
              `}
              >
                <span>{step.icon}</span>
                <span className="text-sm font-medium">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div className="w-8 h-0.5 bg-gray-300"></div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            PlanTakeoff Platform
          </h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Upload your architectural and MEP plans to extract geometry,
            dimensions, and generate automated takeoff data with materials
            lists.
          </p>

          {/* API Status and Job Queue */}
          <div className="mt-4 flex justify-center items-center gap-3">
            <div
              className={`
              inline-flex items-center px-3 py-1 rounded-full text-xs font-medium
              ${
                apiHealth?.status === "ok"
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }
            `}
            >
              <div
                className={`w-2 h-2 rounded-full mr-2 ${
                  apiHealth?.status === "ok" ? "bg-green-500" : "bg-red-500"
                }`}
              ></div>
              API {apiHealth?.status === "ok" ? "Connected" : "Disconnected"}
            </div>
            <button
              onClick={() => setShowJobQueueModal(true)}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Job Queue
            </button>
          </div>
        </header>

        {/* Step Indicator */}
        {renderStepIndicator()}

        {/* Error Display - Don't show for cancelled jobs */}
        {error && jobStatus?.status !== 'CANCELLED' && (
          <div className="max-w-4xl mx-auto mb-8">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <svg
                  className="w-5 h-5 text-red-500 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-red-800">Error</h4>
                  <p className="text-sm text-red-700 mt-1">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Job Queue Modal */}
        {showJobQueueModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="flex justify-between items-center p-6 border-b">
                <h2 className="text-xl font-semibold">Job Queue</h2>
                <button
                  onClick={() => setShowJobQueueModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-6">
                <JobQueue
                  onJobSelect={(selectedJobId) => {
                    setJobId(selectedJobId);
                    localStorage.setItem('currentJobId', selectedJobId);
                    setShowJobQueueModal(false);
                    // Fetch status and navigate to appropriate step
                    apiService.getJobStatus(selectedJobId)
                      .then((status) => {
                        setJobStatus(status);
                        if (status.status === 'COMPLETED') {
                          setCurrentStep('results');
                          localStorage.setItem('currentStep', 'results');
                          // Pass selectedJobId directly to avoid race condition with state update
                          loadResults(selectedJobId);
                        } else if (status.status === 'FAILED') {
                          setCurrentStep('upload');
                          setError(status.error || 'Job processing failed');
                        } else if (status.status === 'CANCELLED') {
                          setCurrentStep('upload');
                          // Don't show error - status badge already shows "CANCELLED"
                        } else {
                          setCurrentStep('processing');
                          localStorage.setItem('currentStep', 'processing');
                        }
                      })
                      .catch((err) => {
                        console.error('Failed to load job:', err);
                        setError('Failed to load job status');
                      });
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step Content */}
        <main className="space-y-8">
          {currentStep === "upload" && (
            <PlanUpload
              onFileUpload={handleFileUpload}
              isUploading={isUploading}
            />
          )}

          {currentStep === "configure" && (
            <div className="space-y-8">
              <div className="max-w-4xl mx-auto bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Uploaded File
                </h3>
                <p className="text-sm text-gray-600">
                  📁 {uploadedFile?.name} (
                  {(uploadedFile?.size || 0) / 1024 / 1024 < 1
                    ? `${Math.round((uploadedFile?.size || 0) / 1024)} KB`
                    : `${((uploadedFile?.size || 0) / 1024 / 1024).toFixed(1)} MB`}
                  )
                </p>
              </div>

              <JobConfiguration onConfigChange={setJobConfig} />

              <div className="text-center">
                <button
                  onClick={handleStartAnalysis}
                  disabled={isStartingAnalysis || !fileId}
                  className={`px-8 py-3 text-white font-medium rounded-lg transition-colors ${
                    isStartingAnalysis || !fileId
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isStartingAnalysis ? 'Starting Analysis...' : 'Start Analysis'}
                </button>
              </div>
            </div>
          )}

          {currentStep === "processing" && (
            <>
              {jobStatus ? (
                <JobProgress
                  jobId={jobStatus.jobId}
                  status={jobStatus.status}
                  progress={jobStatus.progress}
                  error={jobStatus.error}
                  startedAt={jobStatus.startedAt}
                  finishedAt={jobStatus.finishedAt}
                />
              ) : (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading job status...</p>
                </div>
              )}
              <div className="mt-6 text-center">
                <button
                  onClick={resetApp}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  ← Start New Analysis
                </button>
              </div>
            </>
          )}

          {currentStep === "results" && takeoffData && (
            <div className="space-y-8">
              <TakeoffResults data={takeoffData} onExport={handleExport} />

              <div className="text-center">
                <button
                  onClick={resetApp}
                  className="px-6 py-2 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Analyze Another Plan
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center mt-16 py-8 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            PlanTakeoff Platform - AI-powered plan analysis and takeoff
            automation
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
