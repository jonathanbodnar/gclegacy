import React, { useState } from 'react';
import { MaterialsList } from './MaterialsList';

interface TakeoffData {
  version: string;
  units: {
    linear: string;
    area: string;
  };
  sheets: Array<{
    id: string;
    scale?: string;
    units?: string;
    discipline?: string;
    name?: string;
  }>;
  rooms: Array<{
    id: string;
    name?: string;
    area: number;
    program?: string;
    dimensions?: {
      width: number;
      length: number;
    };
    finishes?: Record<string, string>;
    specifications?: Record<string, any>;
  }>;
  walls: Array<{
    id: string;
    length: number;
    partitionType?: string;
    height?: number;
  }>;
  openings: Array<{
    id: string;
    openingType: string;
    width?: number;
    height?: number;
  }>;
  pipes: Array<{
    id: string;
    service: string;
    diameterIn: number;
    length: number;
  }>;
  ducts: Array<{
    id: string;
    size: string;
    length: number;
  }>;
  fixtures: Array<{
    id: string;
    fixtureType: string;
    count: number;
    specifications?: Record<string, any> | string;
  }>;
  meta?: {
    fileId?: string;
    jobId?: string;
    generatedAt?: string;
  };
}

interface TakeoffResultsProps {
  data: TakeoffData;
  onExport?: (format: 'json' | 'csv') => void;
}

export const TakeoffResults: React.FC<TakeoffResultsProps> = ({ data, onExport }) => {
  const [activeTab, setActiveTab] = useState<string>('summary');

  const tabs = [
    { id: 'summary', label: 'Summary', count: null },
    { id: 'rooms', label: 'Rooms', count: data.rooms.length },
    { id: 'walls', label: 'Walls', count: data.walls.length },
    { id: 'openings', label: 'Openings', count: data.openings.length },
    { id: 'pipes', label: 'Pipes', count: data.pipes.length },
    { id: 'ducts', label: 'Ducts', count: data.ducts.length },
    { id: 'fixtures', label: 'Fixtures', count: data.fixtures.length },
    { id: 'materials', label: 'Materials', count: null },
  ];

  const formatNumber = (num: number, decimals: number = 1) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  };

  const getTotalArea = () => data.rooms.reduce((sum, room) => sum + room.area, 0);
  const getTotalWallLength = () => data.walls.reduce((sum, wall) => sum + wall.length, 0);
  const getTotalPipeLength = () => data.pipes.reduce((sum, pipe) => sum + pipe.length, 0);
  const getTotalDuctLength = () => data.ducts.reduce((sum, duct) => sum + duct.length, 0);

  const renderSummary = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="text-2xl font-bold text-blue-900">{data.rooms.length}</div>
        <div className="text-sm text-blue-700">Total Rooms</div>
        <div className="text-xs text-blue-600 mt-1">
          {formatNumber(getTotalArea())} {data.units.area}
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="text-2xl font-bold text-green-900">{formatNumber(getTotalWallLength())}</div>
        <div className="text-sm text-green-700">Wall Length ({data.units.linear})</div>
        <div className="text-xs text-green-600 mt-1">{data.walls.length} wall segments</div>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
        <div className="text-2xl font-bold text-purple-900">{formatNumber(getTotalPipeLength())}</div>
        <div className="text-sm text-purple-700">Pipe Length ({data.units.linear})</div>
        <div className="text-xs text-purple-600 mt-1">{data.pipes.length} pipe runs</div>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
        <div className="text-2xl font-bold text-orange-900">{formatNumber(getTotalDuctLength())}</div>
        <div className="text-sm text-orange-700">Duct Length ({data.units.linear})</div>
        <div className="text-xs text-orange-600 mt-1">{data.ducts.length} duct runs</div>
      </div>
    </div>
  );

  const renderTable = (items: any[], columns: Array<{key: string, label: string, format?: (val: any) => string}>) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map((col) => (
              <th key={col.key} className="text-left py-3 px-4 font-medium text-gray-900">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id || index} className="border-b border-gray-100 hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col.key} className="py-3 px-4 text-gray-700">
                  {col.format ? col.format(item[col.key]) : (item[col.key] || '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'summary':
        return renderSummary();
      
      case 'rooms':
        return (
          <div className="space-y-6">
            {data.rooms.map((room, index) => (
              <div key={room.id || index} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Basic Info */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">{room.name}</h4>
                    <div className="space-y-1 text-sm text-gray-600">
                      <div><span className="font-medium">ID:</span> {room.id}</div>
                      <div><span className="font-medium">Area:</span> {formatNumber(room.area)} {data.units.area}</div>
                      <div><span className="font-medium">Program:</span> {room.program}</div>
                      {room.dimensions && (
                        <div><span className="font-medium">Dimensions:</span> {room.dimensions.width}' × {room.dimensions.length}'</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Finishes */}
                  {room.finishes && (
                    <div>
                      <h5 className="font-medium text-gray-700 mb-2">Finishes</h5>
                      <div className="space-y-1 text-xs text-gray-600">
                        {Object.entries(room.finishes).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium capitalize">{key}:</span>
                            <span className="ml-1">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Specifications */}
                  {room.specifications && (
                    <div>
                      <h5 className="font-medium text-gray-700 mb-2">Specifications</h5>
                      <div className="space-y-1 text-xs text-gray-600">
                        {Object.entries(room.specifications).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                            <span className="ml-1">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      
      case 'walls':
        return renderTable(data.walls, [
          { key: 'id', label: 'ID' },
          { key: 'partitionType', label: 'Type' },
          { key: 'length', label: `Length (${data.units.linear})`, format: (val) => formatNumber(val) },
          { key: 'height', label: `Height (${data.units.linear})`, format: (val) => val ? formatNumber(val) : '-' },
        ]);
      
      case 'openings':
        return renderTable(data.openings, [
          { key: 'id', label: 'ID' },
          { key: 'openingType', label: 'Type' },
          { key: 'width', label: `Width (${data.units.linear})`, format: (val) => val ? formatNumber(val) : '-' },
          { key: 'height', label: `Height (${data.units.linear})`, format: (val) => val ? formatNumber(val) : '-' },
        ]);
      
      case 'pipes':
        return renderTable(data.pipes, [
          { key: 'id', label: 'ID' },
          { key: 'service', label: 'Service' },
          { key: 'diameterIn', label: 'Diameter (in)', format: (val) => formatNumber(val, 2) },
          { key: 'length', label: `Length (${data.units.linear})`, format: (val) => formatNumber(val) },
        ]);
      
      case 'ducts':
        return renderTable(data.ducts, [
          { key: 'id', label: 'ID' },
          { key: 'size', label: 'Size' },
          { key: 'length', label: `Length (${data.units.linear})`, format: (val) => formatNumber(val) },
        ]);
      
      case 'fixtures':
        return (
          <div className="space-y-6">
            {data.fixtures.map((fixture, index) => (
              <div key={fixture.id || index} className="bg-gray-50 rounded-lg p-6 border">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Basic Info */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">{fixture.fixtureType}</h4>
                    <div className="space-y-2 text-sm">
                      <div><span className="font-medium">ID:</span> {fixture.id}</div>
                      <div><span className="font-medium">Count:</span> {fixture.count}</div>
                      {fixture.specifications && (
                        <div><span className="font-medium">Model:</span> {String(fixture.specifications)}</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Detailed Specifications */}
                  {fixture.specifications && typeof fixture.specifications === 'object' && (
                    <div>
                      <h5 className="font-medium text-gray-700 mb-2">Specifications</h5>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                        {Object.entries(fixture.specifications).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                            <span className="ml-1">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      
      case 'materials':
        return <MaterialsList jobId={data.meta?.jobId} />;
      
      default:
        return <div>Select a tab to view results</div>;
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200">
        {/* Header */}
        <div className="border-b border-gray-200 p-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Takeoff Results</h3>
              <p className="text-sm text-gray-500 mt-1">
                Analysis complete • Units: {data.units.linear}, {data.units.area}
              </p>
            </div>
            
            {onExport && (
              <div className="flex space-x-2">
                <button
                  onClick={() => onExport('json')}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Export JSON
                </button>
                <button
                  onClick={() => onExport('csv')}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                >
                  Export CSV
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
                {tab.count !== null && (
                  <span className="ml-2 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};
