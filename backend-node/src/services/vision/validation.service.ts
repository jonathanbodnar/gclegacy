export interface ValidationResult {
  isValid: boolean;
  confidence: number;
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
  roomAreaMin: number;
  roomAreaMax: number;
  roomHeightMin: number;
  roomHeightMax: number;
  wallLengthMin: number;
  wallLengthMax: number;
  wallHeightMin: number;
  wallHeightMax: number;
  doorWidthMin: number;
  doorWidthMax: number;
  doorHeightMin: number;
  doorHeightMax: number;
  windowWidthMin: number;
  windowWidthMax: number;
  windowHeightMin: number;
  windowHeightMax: number;
  pipeDiameterMin: number;
  pipeDiameterMax: number;
  pipeLengthMin: number;
  pipeLengthMax: number;
  ductLengthMin: number;
  ductLengthMax: number;
  fixtureCountMin: number;
  fixtureCountMax: number;
}

const DEFAULT_LIMITS: DimensionLimits = {
  roomAreaMin: 50,
  roomAreaMax: 50000,
  roomHeightMin: 6,
  roomHeightMax: 30,
  wallLengthMin: 1,
  wallLengthMax: 1000,
  wallHeightMin: 6,
  wallHeightMax: 30,
  doorWidthMin: 2,
  doorWidthMax: 8,
  doorHeightMin: 6,
  doorHeightMax: 10,
  windowWidthMin: 1,
  windowWidthMax: 20,
  windowHeightMin: 1,
  windowHeightMax: 10,
  pipeDiameterMin: 0.5,
  pipeDiameterMax: 24,
  pipeLengthMin: 1,
  pipeLengthMax: 1000,
  ductLengthMin: 1,
  ductLengthMax: 1000,
  fixtureCountMin: 1,
  fixtureCountMax: 1000,
};

export class ValidationService {
  private limits: DimensionLimits = DEFAULT_LIMITS;

  validateFeature(feature: any, strictMode = false): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    let confidence = 1;

    if (!feature || !feature.type) {
      return {
        isValid: false,
        confidence: 0,
        issues: [
          { type: 'geometry', severity: 'error', message: 'Feature is missing type' },
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

    if (strictMode && !feature.provenance) {
      issues.push({
        type: 'provenance',
        severity: 'error',
        message: 'Missing provenance data (required in strict mode)',
      });
      confidence *= 0.5;
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    confidence *= Math.max(0, 1 - errorCount * 0.3 - warningCount * 0.1);
    const isValid = strictMode ? errorCount === 0 && confidence >= 0.7 : errorCount === 0;

    return {
      isValid,
      confidence: Math.max(0, Math.min(1, confidence)),
      issues,
      warnings,
    };
  }

  private validateRoom(room: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    if (room.area !== undefined && room.area !== null) {
      if (room.area < this.limits.roomAreaMin || room.area > this.limits.roomAreaMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Room area ${room.area} sq ft is outside expected range`,
          field: 'area',
          value: room.area,
          expectedRange: { min: this.limits.roomAreaMin, max: this.limits.roomAreaMax },
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

    const height = room.props?.heightFt || room.heightFt;
    if (height !== undefined && height !== null) {
      if (height < this.limits.roomHeightMin || height > this.limits.roomHeightMax) {
        issues.push({
          type: 'dimension',
          severity: 'warning',
          message: `Room height ${height} ft is outside typical range`,
          field: 'heightFt',
          value: height,
          expectedRange: { min: this.limits.roomHeightMin, max: this.limits.roomHeightMax },
        });
      }
    }

    if (room.polygon) {
      this.validatePolygon(room.polygon, 'room', issues);
    }
  }

  private validateWall(wall: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    const length = wall.length || wall.props?.length;
    if (length !== undefined && length !== null) {
      if (length < this.limits.wallLengthMin || length > this.limits.wallLengthMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Wall length ${length} ft is outside typical range`,
          field: 'length',
          value: length,
          expectedRange: { min: this.limits.wallLengthMin, max: this.limits.wallLengthMax },
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

    if (wall.polyline) {
      this.validatePolyline(wall.polyline, 'wall', issues);
    }
  }

  private validateOpening(opening: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    const width = opening.width || opening.props?.widthFt || opening.props?.width;
    const height = opening.height || opening.props?.heightFt || opening.props?.height;
    const type = opening.openingType || opening.type || opening.props?.openingType;
    const isDoor = type === 'door';
    const isWindow = type === 'window';

    if (isDoor) {
      if (width !== undefined && width !== null) {
        if (width < this.limits.doorWidthMin || width > this.limits.doorWidthMax) {
          issues.push({
            type: 'dimension',
            severity: strictMode ? 'error' : 'warning',
            message: `Door width ${width} ft is outside typical range`,
            field: 'width',
            value: width,
            expectedRange: { min: this.limits.doorWidthMin, max: this.limits.doorWidthMax },
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
            expectedRange: { min: this.limits.doorHeightMin, max: this.limits.doorHeightMax },
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
            expectedRange: { min: this.limits.windowWidthMin, max: this.limits.windowWidthMax },
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
            expectedRange: { min: this.limits.windowHeightMin, max: this.limits.windowHeightMax },
          });
        }
      }
    }
  }

  private validatePipe(pipe: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    const diameter = pipe.diameter || pipe.props?.diameterIn;
    if (diameter !== undefined && diameter !== null) {
      if (diameter < this.limits.pipeDiameterMin || diameter > this.limits.pipeDiameterMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Pipe diameter ${diameter} inches is outside typical range`,
          field: 'diameter',
          value: diameter,
          expectedRange: { min: this.limits.pipeDiameterMin, max: this.limits.pipeDiameterMax },
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
          expectedRange: { min: this.limits.pipeLengthMin, max: this.limits.pipeLengthMax },
        });
      }
    }
  }

  private validateDuct(duct: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    const length = duct.length || duct.props?.length;
    if (length !== undefined && length !== null) {
      if (length < this.limits.ductLengthMin || length > this.limits.ductLengthMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Duct length ${length} ft is outside typical range`,
          field: 'length',
          value: length,
          expectedRange: { min: this.limits.ductLengthMin, max: this.limits.ductLengthMax },
        });
      }
    }
  }

  private validateFixture(fixture: any, issues: ValidationIssue[], warnings: string[], strictMode: boolean) {
    const count = fixture.count || fixture.props?.count;
    if (count !== undefined && count !== null) {
      if (count < this.limits.fixtureCountMin || count > this.limits.fixtureCountMax) {
        issues.push({
          type: 'dimension',
          severity: strictMode ? 'error' : 'warning',
          message: `Fixture count ${count} is outside typical range`,
          field: 'count',
          value: count,
          expectedRange: { min: this.limits.fixtureCountMin, max: this.limits.fixtureCountMax },
        });
      }
    }
  }

  private validatePolygon(polygon: any[], _label: string, issues: ValidationIssue[]) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      issues.push({
        type: 'geometry',
        severity: 'warning',
        message: 'Polygon has insufficient vertices',
      });
    }
  }

  private validatePolyline(polyline: any[], _label: string, issues: ValidationIssue[]) {
    if (!Array.isArray(polyline) || polyline.length < 2) {
      issues.push({
        type: 'geometry',
        severity: 'warning',
        message: 'Polyline has insufficient points',
      });
    }
  }
}

