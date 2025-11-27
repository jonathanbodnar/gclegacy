import { MaterialModel } from '../models/material.model';
import { JobModel } from '../models/job.model';
import { HttpError } from '../utils/http-error';

export interface MaterialItemResponse {
  sku: string;
  qty: number;
  uom: string;
  description?: string;
  category?: string;
  unitPrice?: number;
  totalPrice?: number;
  source?: {
    rule?: string;
    features?: string[];
  };
}

export interface MaterialsResponse {
  jobId: string;
  currency: string;
  items: MaterialItemResponse[];
  summary: {
    totalItems: number;
    totalValue: number;
    categories: string[];
    generatedAt: string;
  };
}

export const getMaterialsForJob = async (jobId: string): Promise<MaterialsResponse> => {
  const job = await JobModel.findById(jobId);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  const materials = await MaterialModel.find({ job: job._id });

  const items: MaterialItemResponse[] = materials.map((material) => ({
    sku: material.sku,
    qty: material.qty,
    uom: material.uom,
    description: material.description,
    category: material.category,
      unitPrice: material.pricing?.unitPrice,
      totalPrice: material.pricing?.totalPrice,
    source: {
      rule: material.ruleId,
      features: (material.sources?.features ?? []).map((featureId) => featureId.toString()),
    },
  }));

  const totalValue = items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
  const categories = Array.from(
    new Set(items.map((item) => item.category).filter((category): category is string => Boolean(category))),
  );

  return {
    jobId: job._id.toString(),
    currency: 'USD',
    items,
    summary: {
      totalItems: items.length,
      totalValue,
      categories,
      generatedAt: new Date().toISOString(),
    },
  };
};

