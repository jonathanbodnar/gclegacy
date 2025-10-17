import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface MaterialsResponse {
  jobId: string;
  currency: string;
  items: MaterialItem[];
  summary: {
    totalItems: number;
    totalValue?: number;
    generatedAt: string;
  };
}

export interface MaterialItem {
  sku: string;
  qty: number;
  uom: string;
  unitPrice?: number;
  totalPrice?: number;
  description?: string;
  category?: string;
  source: {
    rule?: string;
    features: string[];
    ruleId?: string;
  };
}

@Injectable()
export class MaterialsService {
  constructor(private prisma: PrismaService) {}

  async getMaterials(jobId: string): Promise<MaterialsResponse> {
    // Verify job exists
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        materials: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Format materials
    const items: MaterialItem[] = job.materials.map(material => ({
      sku: material.sku,
      qty: material.qty,
      uom: material.uom,
      source: {
        rule: this.getRuleDescription(material.ruleId),
        features: this.extractFeatureIds(material.sources),
        ruleId: material.ruleId,
      },
      // In production, you would look up pricing from a materials database
      unitPrice: this.getMockUnitPrice(material.sku),
      totalPrice: this.getMockUnitPrice(material.sku) * material.qty,
      description: this.getMockDescription(material.sku),
      category: this.getMockCategory(material.sku),
    }));

    const totalValue = items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

    return {
      jobId: job.id,
      currency: 'USD',
      items,
      summary: {
        totalItems: items.length,
        totalValue,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private getRuleDescription(ruleId: string | null): string {
    // In production, you would look up the rule description from the rule set
    const ruleDescriptions: Record<string, string> = {
      'PT-1 studs': 'PT-1 Partition - Metal Studs',
      'CW 1in pipe': 'Cold Water - 1" PVC Pipe',
      'HW 3/4in pipe': 'Hot Water - 3/4" Copper Pipe',
      'HVAC duct': 'HVAC Ductwork',
      'electrical fixture': 'Electrical Fixtures',
    };

    return ruleId ? (ruleDescriptions[ruleId] || `Rule ${ruleId}`) : 'Unknown Rule';
  }

  private extractFeatureIds(sources: any): string[] {
    if (!sources) return [];
    
    if (typeof sources === 'object' && sources.features) {
      return Array.isArray(sources.features) ? sources.features : [sources.features];
    }
    
    return [];
  }

  // Mock pricing data - in production, this would come from a materials database
  private getMockUnitPrice(sku: string): number {
    const prices: Record<string, number> = {
      'STUD-362-20GA': 8.50,
      'GWB-58X-TypeX': 12.75,
      'INSUL-ACOUSTIC': 1.25,
      'PVC-1IN': 2.85,
      'COUPLING-1IN': 3.20,
      'COPPER-3/4IN': 4.15,
      'ELBOW-3/4IN': 2.45,
      'DUCT-12X10': 8.90,
      'REGISTER-12X10': 35.50,
      'LED-2X4-40W': 89.99,
      'SWITCH-SINGLE': 12.50,
    };

    return prices[sku] || 10.00; // Default price
  }

  private getMockDescription(sku: string): string {
    const descriptions: Record<string, string> = {
      'STUD-362-20GA': '3-5/8" Metal Stud, 20 GA',
      'GWB-58X-TypeX': '5/8" Gypsum Board, Type X',
      'INSUL-ACOUSTIC': 'Acoustic Insulation Batt',
      'PVC-1IN': '1" PVC Pipe, Schedule 40',
      'COUPLING-1IN': '1" PVC Coupling',
      'COPPER-3/4IN': '3/4" Copper Pipe, Type L',
      'ELBOW-3/4IN': '3/4" Copper 90° Elbow',
      'DUCT-12X10': '12" x 10" Galvanized Duct',
      'REGISTER-12X10': '12" x 10" Supply Register',
      'LED-2X4-40W': '2x4 LED Troffer, 40W',
      'SWITCH-SINGLE': 'Single Pole Switch, 15A',
    };

    return descriptions[sku] || 'Material Item';
  }

  private getMockCategory(sku: string): string {
    if (sku.includes('STUD') || sku.includes('GWB') || sku.includes('INSUL')) {
      return 'Framing & Drywall';
    }
    if (sku.includes('PVC') || sku.includes('COPPER') || sku.includes('COUPLING') || sku.includes('ELBOW')) {
      return 'Plumbing';
    }
    if (sku.includes('DUCT') || sku.includes('REGISTER')) {
      return 'HVAC';
    }
    if (sku.includes('LED') || sku.includes('SWITCH')) {
      return 'Electrical';
    }
    
    return 'General';
  }

  async exportMaterials(jobId: string, format: 'json' | 'csv' = 'json'): Promise<string> {
    const materials = await this.getMaterials(jobId);
    
    if (format === 'csv') {
      return this.convertToCSV(materials);
    }
    
    return JSON.stringify(materials, null, 2);
  }

  private convertToCSV(materials: MaterialsResponse): string {
    const headers = ['SKU', 'Description', 'Quantity', 'UOM', 'Unit Price', 'Total Price', 'Category', 'Source Rule'];
    const rows = materials.items.map(item => [
      item.sku,
      item.description || '',
      item.qty.toString(),
      item.uom,
      item.unitPrice?.toFixed(2) || '0.00',
      item.totalPrice?.toFixed(2) || '0.00',
      item.category || '',
      item.source.rule || '',
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}
