import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface PlanUploadProps {
  onFileUpload: (file: File) => void;
  isUploading: boolean;
}

export const PlanUpload: React.FC<PlanUploadProps> = ({ onFileUpload, isUploading }) => {

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileUpload(acceptedFiles[0]);
    }
  }, [onFileUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/vnd.dwg': ['.dwg'],
      'application/vnd.dwg': ['.dwg'],
      'image/vnd.dxf': ['.dxf'],
      'model/vnd.ifc': ['.ifc'],
    },
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-200
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400 bg-white'
          }
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <div className="space-y-4">
          {/* Upload Icon */}
          <div className="flex justify-center">
            <svg 
              className={`w-16 h-16 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
              />
            </svg>
          </div>

          {/* Upload Text */}
          <div>
            <p className="text-lg font-medium text-gray-900 mb-2">
              {isUploading 
                ? 'Uploading...' 
                : isDragActive 
                  ? 'Drop your plan file here' 
                  : 'Upload Architectural/MEP Plans'
              }
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Drag and drop your plan file here, or click to browse
            </p>
          </div>

          {/* Supported Formats */}
          <div className="flex flex-wrap justify-center gap-2">
            {['PDF', 'DWG', 'DXF', 'IFC'].map((format) => (
              <span 
                key={format}
                className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full"
              >
                {format}
              </span>
            ))}
          </div>

          {/* Loading Indicator */}
          {isUploading && (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Guidelines */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-2">Upload Guidelines</h3>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Maximum file size: 100MB</li>
          <li>• Supported formats: PDF, DWG, DXF, IFC</li>
          <li>• Multi-sheet PDFs are supported</li>
          <li>• Ensure plans include scale information for best results</li>
        </ul>
      </div>
    </div>
  );
};
