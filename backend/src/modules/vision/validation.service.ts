import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  isValid: boolean;
  confidence: number; // 0-1
  issues: ValidationIssue[];
  warnings: string[];
}

export interface ValidationIssue {
  type: 'dimension' | 'geometry' | 'consistency' | 'provenance' | 'material';
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  value?: any;
  expectedRange?: { min: number; max: number };
}

export interface DimensionLimits {
  // Room dimensions
  roomAreaMin: number; // sq ft
  roomAreaMax: number;
  roomHeightMin: number; // ft
  roomHeightMax: number;
  
  // Wall dimensions
  wallLengthMin: number; // ft
  wallLengthMax: number;
  wallHeightMin: number;
  wallHeightMax: number;
  
  // Opening dimensions
  doorWidthMin: number;
  doorWidthMax: number;
  doorHeightMin: number;
  doorHeightMax: number;
  windowWidthMin: number;
  windowWidthMax: number;
  windowHeightMin: number;
  windowHeightMax: number;
  
  // Pipe dimensions
  pipeDiameterMin: number; // inches
  pipeDiameterMax: number;
  pipeLengthMin: number; // ft
  pipeLengthMax: number;
  
  // Duct dimensions
  ductLengthMin: number; // ft
  ductLengthMax: number;
  
  // Fixture counts
  fixtureCountMin: number;
  fixtureCountMax: number;
}

const DEFAULT_LIMITS: DimensionLimits = {
  // Rooms: 50 sq ft to 50,000 sq ft
  roomAreaMin: 50,
  roomAreaMax: 50000,
  roomHeightMin: 6, // 6 ft minimum ceiling
  roomHeightMax: 30, // 30 ft maximum ceiling
  
  // Walls: 1 ft to 1000 ft
  wallLengthMin: 1,
  wallLengthMax: 1000,
  wallHeightMin: 6,
  wallHeightMax: 30,
  
  // Doors: 2 ft to 8 ft wide, 6 ft to 10 ft tall
  doorWidthMin: 2,
  doorWidthMax: 8,
  doorHeightMin: 6,
  doorHeightMax: 10,
  
  // Windows: 1 ft to 20 ft wide, 1 ft to 10 ft tall
  windowWidthMin: 1,
  windowWidthMax: 20,
  windowHeightMin: 1,
  windowHeightMax: 10,
  
  // Pipes: 0.5" to 24" diameter, 1 ft to 1000 ft length
  pipeDiameterMin: 0.5,
  pipeDiameterMax: 24,
  pipeLengthMin: 1,
  pipeLengthMax: 1000,
  
  // Ducts: 1 ft to 1000 ft length
  ductLengthMin: 1,
  ductLengthMax: 1000,
  
  // Fixtures: 1 to 1000 per room
  fixtureCountMin: 1,
  fixtureCountMax: 1000,
};

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);
  private limits: DimensionLimits;

  constructor() {
    this.limits = DEFAULT_LIMITS;
  }

  /**
   * Validate a feature's dimensions and properties
   */
  validateFeature(
    feature: any,
    strictMode: boolean = false
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    if (!feature || !feature.type) {
      return {
        isValid: false,
        confidence: 0,
        issues: [
          {
            type: 'geometry',
            severity: 'error',
            message: 'Feature is missing type',
          },
        ],
        warnings: [],
      };
    }

    switch (feature.type) {
      case 'ROOM':
        this.validateRoom(feature, issues, warnings, strictMode);
        break;
      case 'WALL':
        this.validateWall(feature, issues, warnings, strictMode);
        break;
      case 'OPENING':
        this.validateOpening(feature, issues, warnings, strictMode);
        break;
      case 'PIPE':
        this.validatePipe(feature, issues, warnings, strictMode);
        break;
      case 'DUCT':
        this.validateDuct(feature, issues, warnings, strictMode);
        break;
      case 'FIXTURE':
        this.validateFixture(feature, issues, warnings, strictMode);
        break;
    }

    // Check for missing provenance in strict mode
    if (strictMode && !feature.provenance) {
      issues.push({
        type: 'provenance',
        severity: 'error',
        message: 'Missing provenance data (required in strict mode)',
      });
      confidence *= 0.5;
    }

    // Calculate confidence based on issues
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    confidence *= Math.max(0, 1 - errorCount * 0.3 - warningCount * 0.1);

    const isValid = strictMode
      ? errorCount === 0 && confidence >= 0.7
      : errorCount === 0;

    return {
      isValid,
      confidence: Math.max(0, Math.min(1, confidence)),
      issues,
      warnings,
    };
  }

  private validateRoom(
    room: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    // Validate area
    if (room.area !== undefined && room.area !== null) {
      if (room.area < this.limits.roomAreaMin) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Room area ${room.area} sq ft is too small`,
          field: 'area',
          value: room.area,
          expectedRange: {
            min: this.limits.roomAreaMin,
            max: this.limits.roomAreaMax,
          },
        });
      } else if (room.area > this.limits.roomAreaMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Room area ${room.area} sq ft is unrealistically large`,
          field: 'area',
          value: room.area,
          expectedRange: {
            min: this.limits.roomAreaMin,
            max: this.limits.roomAreaMax,
          },
        });
      }
    } else if (strictMode) {
      issues.push({
        type: 'dimension',
        severity: 'error',
        message: 'Room area is missing (required in strict mode)',
        field: 'area',
      });
    }

    // Validate height
    const height = room.props?.heightFt || room.heightFt;
    if (height !== undefined && height !== null) {
      if (height < this.limits.roomHeightMin || height > this.limits.roomHeightMax) {
        issues.push({
          type: 'dimension',
          severity: 'warning',
          message: `Room height ${height} ft is outside typical range`,
          field: 'heightFt',
          value: height,
          expectedRange: {
            min: this.limits.roomHeightMin,
            max: this.limits.roomHeightMax,
          },
        });
      }
    }

    // Validate polygon if present
    if (room.polygon) {
      this.validatePolygon(room.polygon, 'room', issues, warnings);
    }
  }

  private validateWall(
    wall: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    const length = wall.length || wall.props?.length;
    if (length !== undefined && length !== null) {
      if (length < this.limits.wallLengthMin) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Wall length ${length} ft is too short`,
          field: 'length',
          value: length,
          expectedRange: {
            min: this.limits.wallLengthMin,
            max: this.limits.wallLengthMax,
          },
        });
      } else if (length > this.limits.wallLengthMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Wall length ${length} ft is unrealistically long`,
          field: 'length',
          value: length,
          expectedRange: {
            min: this.limits.wallLengthMin,
            max: this.limits.wallLengthMax,
          },
        });
      }
    } else if (strictMode) {
      issues.push({
        type: 'dimension',
        severity: 'error',
        message: 'Wall length is missing (required in strict mode)',
        field: 'length',
      });
    }

    // Validate polyline if present
    if (wall.polyline) {
      this.validatePolyline(wall.polyline, 'wall', issues, warnings);
    }
  }

  private validateOpening(
    opening: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    const width = opening.width || opening.props?.width;
    const height = opening.height || opening.props?.height;
    const isDoor = opening.type === 'door' || opening.props?.openingType === 'door';
    const isWindow = opening.type === 'window' || opening.props?.openingType === 'window';

    if (isDoor) {
      if (width !== undefined && width !== null) {
        if (width < this.limits.doorWidthMin || width > this.limits.doorWidthMax) {
          issues.push({
            type: 'dimension',
            severity: strictMode ? 'error' : 'warning',
            message: `Door width ${width} ft is outside typical range`,
            field: 'width',
            value: width,
            expectedRange: {
              min: this.limits.doorWidthMin,
              max: this.limits.doorWidthMax,
            },
          });
        }
      }
      if (height !== undefined && height !== null) {
        if (height < this.limits.doorHeightMin || height > this.limits.doorHeightMax) {
          issues.push({
            type: 'dimension',
            severity: 'warning',
            message: `Door height ${height} ft is outside typical range`,
            field: 'height',
            value: height,
            expectedRange: {
              min: this.limits.doorHeightMin,
              max: this.limits.doorHeightMax,
            },
          });
        }
      }
    } else if (isWindow) {
      if (width !== undefined && width !== null) {
        if (width < this.limits.windowWidthMin || width > this.limits.windowWidthMax) {
          issues.push({
            type: 'dimension',
            severity: strictMode ? 'error' : 'warning',
            message: `Window width ${width} ft is outside typical range`,
            field: 'width',
            value: width,
            expectedRange: {
              min: this.limits.windowWidthMin,
              max: this.limits.windowWidthMax,
            },
          });
        }
      }
      if (height !== undefined && height !== null) {
        if (height < this.limits.windowHeightMin || height > this.limits.windowHeightMax) {
          issues.push({
            type: 'dimension',
            severity: 'warning',
            message: `Window height ${height} ft is outside typical range`,
            field: 'height',
            value: height,
            expectedRange: {
              min: this.limits.windowHeightMin,
              max: this.limits.windowHeightMax,
            },
          });
        }
      }
    }
  }

  private validatePipe(
    pipe: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    const diameter = pipe.diameter || pipe.props?.diameterIn;
    if (diameter !== undefined && diameter !== null) {
      if (diameter < this.limits.pipeDiameterMin || diameter > this.limits.pipeDiameterMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Pipe diameter ${diameter} inches is outside typical range`,
          field: 'diameter',
          value: diameter,
          expectedRange: {
            min: this.limits.pipeDiameterMin,
            max: this.limits.pipeDiameterMax,
          },
        });
      }
    }

    const length = pipe.length || pipe.props?.length;
    if (length !== undefined && length !== null) {
      if (length < this.limits.pipeLengthMin || length > this.limits.pipeLengthMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Pipe length ${length} ft is outside typical range`,
          field: 'length',
          value: length,
          expectedRange: {
            min: this.limits.pipeLengthMin,
            max: this.limits.pipeLengthMax,
          },
        });
      }
    }
  }

  private validateDuct(
    duct: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    const length = duct.length || duct.props?.length;
    if (length !== undefined && length !== null) {
      if (length < this.limits.ductLengthMin || length > this.limits.ductLengthMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Duct length ${length} ft is outside typical range`,
          field: 'length',
          value: length,
          expectedRange: {
            min: this.limits.ductLengthMin,
            max: this.limits.ductLengthMax,
          },
        });
      }
    }
  }

  private validateFixture(
    fixture: any,
    issues: ValidationIssue[],
    warnings: string[],
    strictMode: boolean
  ): void {
    const count = fixture.count || fixture.props?.count;
    if (count !== undefined && count !== null) {
      if (count < this.limits.fixtureCountMin || count > this.limits.fixtureCountMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Fixture count ${count} is outside typical range`,
          field: 'count',
          value: count,
          expectedRange: {
            min: this.limits.fixtureCountMin,
            max: this.limits.fixtureCountMax,
          },
        });
      }
    }
  }

  private validatePolygon(
    polygon: any,
    featureType: string,
    issues: ValidationIssue[],
    warnings: string[]
  ): void {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      issues.push({
        type: 'geometry',
        severity: 'error',
        message: `${featureType} polygon must have at least 3 vertices`,
        field: 'polygon',
      });
      return;
    }

    // Check if polygon is closed
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (
      !Array.isArray(first) ||
      !Array.isArray(last) ||
      first.length < 2 ||
      last.length < 2 ||
      Math.abs(first[0] - last[0]) > 0.001 ||
      Math.abs(first[1] - last[1]) > 0.001
    ) {
      warnings.push(`${featureType} polygon is not closed`);
    }

    // Validate all coordinates are numbers
    for (let i = 0; i < polygon.length; i++) {
      const pt = polygon[i];
      if (
        !Array.isArray(pt) ||
        pt.length < 2 ||
        !Number.isFinite(pt[0]) ||
        !Number.isFinite(pt[1])
      ) {
        issues.push({
          type: 'geometry',
          severity: 'error',
          message: `${featureType} polygon has invalid coordinate at index ${i}`,
          field: 'polygon',
        });
      }
    }
  }

  private validatePolyline(
    polyline: any,
    featureType: string,
    issues: ValidationIssue[],
    warnings: string[]
  ): void {
    if (!Array.isArray(polyline) || polyline.length < 2) {
      issues.push({
        type: 'geometry',
        severity: 'error',
        message: `${featureType} polyline must have at least 2 points`,
        field: 'polyline',
      });
      return;
    }

    // Check for duplicate points (zero-length segment)
    for (let i = 1; i < polyline.length; i++) {
      const prev = polyline[i - 1];
      const curr = polyline[i];
      if (
        Array.isArray(prev) &&
        Array.isArray(curr) &&
        prev.length >= 2 &&
        curr.length >= 2 &&
        Math.abs(prev[0] - curr[0]) < 0.001 &&
        Math.abs(prev[1] - curr[1]) < 0.001
      ) {
        warnings.push(`${featureType} polyline has duplicate points at index ${i}`);
      }
    }

    // Validate all coordinates are numbers
    for (let i = 0; i < polyline.length; i++) {
      const pt = polyline[i];
      if (
        !Array.isArray(pt) ||
        pt.length < 2 ||
        !Number.isFinite(pt[0]) ||
        !Number.isFinite(pt[1])
      ) {
        issues.push({
          type: 'geometry',
          severity: 'error',
          message: `${featureType} polyline has invalid coordinate at index ${i}`,
          field: 'polyline',
        });
      }
    }
  }

  /**
   * Validate scale information
   */
  validateScale(scale: {
    detected?: string;
    units?: string;
    ratio?: number;
  }): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];

    if (!scale.detected || scale.detected === 'Unknown') {
      issues.push({
        type: 'dimension',
        severity: 'warning',
        message: 'Scale not detected from drawing',
        field: 'scale.detected',
      });
    }

    if (!scale.units || !['ft', 'm'].includes(scale.units)) {
      issues.push({
        type: 'dimension',
        severity: 'error',
        message: `Invalid scale units: ${scale.units}`,
        field: 'scale.units',
        value: scale.units,
      });
    }

    if (!scale.ratio || scale.ratio <= 0 || !Number.isFinite(scale.ratio)) {
      issues.push({
        type: 'dimension',
        severity: 'error',
        message: `Invalid scale ratio: ${scale.ratio}`,
        field: 'scale.ratio',
        value: scale.ratio,
      });
    } else if (scale.ratio < 1 || scale.ratio > 10000) {
      warnings.push(`Scale ratio ${scale.ratio} seems unusual`);
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const isValid = errorCount === 0;

    return {
      isValid,
      confidence: isValid ? 0.9 : 0.5,
      issues,
      warnings,
    };
  }

  /**
   * Set custom dimension limits
   */
  setLimits(limits: Partial<DimensionLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /**
   * Get current dimension limits
   */
  getLimits(): DimensionLimits {
    return { ...this.limits };
  }
}

