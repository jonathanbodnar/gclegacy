import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

interface MaterialsListProps {
  jobId?: string;
}

interface MaterialItem {
  sku: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  totalPrice: number;
  category: string;
  specifications?: Record<string, any>;
  installation?: Record<string, any>;
  accessories?: Array<{ item: string; qty: number; specification: string }>;
  compliance?: Record<string, string>;
  source: string;
}

interface MaterialsData {
  jobId: string;
  currency: string;
  items: MaterialItem[];
  summary: {
    totalItems: number;
    totalValue: number;
    categories: string[];
    generatedAt: string;
    buildingType?: string;
    extractionMethod?: string;
  };
}

export const MaterialsList: React.FC<MaterialsListProps> = ({ jobId }) => {
  const [materials, setMaterials] = useState<MaterialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (jobId) {
      loadMaterials();
    }
  }, [jobId]);

  const loadMaterials = async () => {
    try {
      setLoading(true);
      const data = await apiService.getMaterials(jobId!);
      setMaterials(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load materials');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (sku: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(sku)) {
      newExpanded.delete(sku);
    } else {
      newExpanded.add(sku);
    }
    setExpandedItems(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="text-red-800">Error loading materials: {error}</div>
      </div>
    );
  }

  if (!materials) {
    return <div>No materials data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <div className="text-2xl font-bold text-blue-900">{materials.summary.totalItems}</div>
            <div className="text-sm text-blue-700">Total Items</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-900">{formatCurrency(materials.summary.totalValue)}</div>
            <div className="text-sm text-blue-700">Total Value</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-900">{materials.summary.categories?.length || 0}</div>
            <div className="text-sm text-blue-700">Categories</div>
          </div>
          <div>
            <div className="text-sm text-blue-700 font-medium">{materials.summary.buildingType}</div>
            <div className="text-xs text-blue-600">{materials.summary.extractionMethod}</div>
          </div>
        </div>
      </div>

      {/* Materials List */}
      <div className="space-y-4">
        {materials.items.map((item, index) => (
          <div key={item.sku || index} className="bg-white rounded-lg border border-gray-200">
            {/* Header - Always Visible */}
            <div 
              className="p-4 cursor-pointer hover:bg-gray-50"
              onClick={() => toggleExpanded(item.sku)}
            >
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="flex items-center space-x-4">
                    <div className="font-medium text-gray-900">{item.description}</div>
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                      {item.category}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    SKU: {item.sku} • Qty: {formatNumber(item.qty)} {item.uom}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">{formatCurrency(item.totalPrice)}</div>
                  <div className="text-sm text-gray-600">{formatCurrency(item.unitPrice)} / {item.uom}</div>
                </div>
                <div className="ml-4">
                  <svg 
                    className={`w-5 h-5 text-gray-400 transform transition-transform ${
                      expandedItems.has(item.sku) ? 'rotate-180' : ''
                    }`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedItems.has(item.sku) && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Specifications */}
                  {item.specifications && (
                    <div>
                      <h6 className="font-medium text-gray-800 mb-3">Technical Specifications</h6>
                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(item.specifications).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="font-medium text-gray-600 capitalize">
                              {key.replace(/([A-Z])/g, ' $1')}:
                            </span>
                            <span className="text-gray-800 text-right ml-4">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Installation Requirements */}
                  {item.installation && (
                    <div>
                      <h6 className="font-medium text-gray-800 mb-3">Installation Requirements</h6>
                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(item.installation).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="font-medium text-gray-600 capitalize">
                              {key.replace(/([A-Z])/g, ' $1')}:
                            </span>
                            <span className="text-gray-800 text-right ml-4">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accessories */}
                {item.accessories && item.accessories.length > 0 && (
                  <div className="mt-4">
                    <h6 className="font-medium text-gray-800 mb-3">Required Accessories</h6>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-300">
                            <th className="text-left py-2 font-medium text-gray-700">Item</th>
                            <th className="text-left py-2 font-medium text-gray-700">Qty</th>
                            <th className="text-left py-2 font-medium text-gray-700">Specification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.accessories.map((accessory, i) => (
                            <tr key={i} className="border-b border-gray-200">
                              <td className="py-2 text-gray-800">{accessory.item}</td>
                              <td className="py-2 text-gray-600">{accessory.qty}</td>
                              <td className="py-2 text-gray-600">{accessory.specification}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Compliance */}
                {item.compliance && (
                  <div className="mt-4">
                    <h6 className="font-medium text-gray-800 mb-3">Code Compliance</h6>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(item.compliance).map(([key, value]) => (
                        <span key={key} className="px-3 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                          {key.toUpperCase()}: {value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source */}
                <div className="mt-4 pt-4 border-t border-gray-300">
                  <div className="text-xs text-gray-500">
                    <span className="font-medium">Source:</span> {item.source}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
