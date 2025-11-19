import React, { useState } from 'react';

interface JobConfig {
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options: {
    bimPreferred: boolean;
    inferScale: boolean;
  };
}

interface JobConfigurationProps {
  onConfigChange: (config: JobConfig) => void;
  disabled?: boolean;
}

export const JobConfiguration: React.FC<JobConfigurationProps> = ({ onConfigChange, disabled = false }) => {
  const [config, setConfig] = useState<JobConfig>({
    disciplines: ['A', 'P', 'M', 'E'], // All disciplines selected by default
    targets: ['rooms', 'walls', 'doors', 'windows', 'pipes', 'ducts', 'fixtures'], // All targets selected
    options: {
      bimPreferred: true,
      inferScale: true,
    }
  });

  const disciplineOptions = [
    { id: 'A', label: 'Architectural', description: 'Floor plans, elevations, sections' },
    { id: 'P', label: 'Plumbing', description: 'Water, sewer, and drain systems' },
    { id: 'M', label: 'Mechanical', description: 'HVAC, ventilation, and air systems' },
    { id: 'E', label: 'Electrical', description: 'Power, lighting, and electrical systems' },
  ];

  const targetOptions = [
    { id: 'rooms', label: 'Rooms', description: 'Room boundaries and areas' },
    { id: 'walls', label: 'Walls', description: 'Wall centerlines and types' },
    { id: 'doors', label: 'Doors', description: 'Door locations and types' },
    { id: 'windows', label: 'Windows', description: 'Window locations and sizes' },
    { id: 'pipes', label: 'Pipes', description: 'Piping systems and runs' },
    { id: 'ducts', label: 'Ducts', description: 'Ductwork and HVAC distribution' },
    { id: 'fixtures', label: 'Fixtures', description: 'Plumbing and electrical fixtures' },
  ];

  const updateConfig = (updates: Partial<JobConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const toggleDiscipline = (disciplineId: string) => {
    const newDisciplines = config.disciplines.includes(disciplineId)
      ? config.disciplines.filter(d => d !== disciplineId)
      : [...config.disciplines, disciplineId];
    updateConfig({ disciplines: newDisciplines });
  };

  const toggleTarget = (targetId: string) => {
    const newTargets = config.targets.includes(targetId)
      ? config.targets.filter(t => t !== targetId)
      : [...config.targets, targetId];
    updateConfig({ targets: newTargets });
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Disciplines Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Plan Disciplines</h3>
        <p className="text-sm text-gray-600 mb-4">Select which types of plans you're uploading</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {disciplineOptions.map((discipline) => (
            <label 
              key={discipline.id}
              className={`
                flex items-start space-x-3 p-4 rounded-lg border cursor-pointer transition-all
                ${config.disciplines.includes(discipline.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                type="checkbox"
                checked={config.disciplines.includes(discipline.id)}
                onChange={() => !disabled && toggleDiscipline(discipline.id)}
                disabled={disabled}
                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <div>
                <div className="font-medium text-gray-900">{discipline.label}</div>
                <div className="text-sm text-gray-500">{discipline.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Extraction Targets Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Extraction Targets</h3>
        <p className="text-sm text-gray-600 mb-4">Choose what features to extract from your plans</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {targetOptions.map((target) => (
            <label 
              key={target.id}
              className={`
                flex items-start space-x-3 p-4 rounded-lg border cursor-pointer transition-all
                ${config.targets.includes(target.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                type="checkbox"
                checked={config.targets.includes(target.id)}
                onChange={() => !disabled && toggleTarget(target.id)}
                disabled={disabled}
                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <div>
                <div className="font-medium text-gray-900">{target.label}</div>
                <div className="text-sm text-gray-500">{target.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Processing Options */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Options</h3>
        
        <div className="space-y-4">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={config.options.bimPreferred}
              onChange={(e) => updateConfig({ 
                options: { ...config.options, bimPreferred: e.target.checked }
              })}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <div className="font-medium text-gray-900">Prefer BIM Data</div>
              <div className="text-sm text-gray-500">Use 3D model data when available (IFC, RVT files)</div>
            </div>
          </label>

          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={config.options.inferScale}
              onChange={(e) => updateConfig({ 
                options: { ...config.options, inferScale: e.target.checked }
              })}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <div className="font-medium text-gray-900">Auto-Detect Scale</div>
              <div className="text-sm text-gray-500">Automatically detect scale from title blocks and dimensions</div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};
