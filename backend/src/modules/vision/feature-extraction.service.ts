import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  OpenAIVisionService,
  VisionAnalysisResult,
} from "./openai-vision.service";
import { ValidationService } from "./validation.service";
import { ConsistencyCheckerService } from "./consistency-checker.service";

@Injectable()
export class FeatureExtractionService {
  private readonly logger = new Logger(FeatureExtractionService.name);
  private readonly sheetIdCache = new Map<string, Map<string, string | null>>();

  constructor(
    private prisma: PrismaService,
    private openaiVision: OpenAIVisionService,
    private validationService: ValidationService,
    private consistencyChecker: ConsistencyCheckerService
  ) {}

  async extractFeatures(
    jobId: string,
    sheetId: string,
    analysisFeatures: any, // Changed from imageBuffer to analysisFeatures
    disciplines: string[],
    targets: string[],
    options?: any
  ): Promise<any[]> {
    // Only log in development to reduce log volume
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`Extracting features for job ${jobId}, sheet ${sheetId}`);
    }

    try {
      const strictMode =
        options?.zeroHallucinationMode === true || options?.strictMode === true;

      // Update sheet with scale information if available
      if (analysisFeatures.scale) {
        await this.updateSheetScale(sheetId, analysisFeatures.scale, jobId);
      }

      // analysisFeatures already contains the OpenAI Vision results
      // Convert OpenAI results to database features
      const features = await this.convertToFeatures(
        jobId,
        sheetId,
        analysisFeatures,
        targets,
        options
      );

      // Validate and filter features
      const validatedFeatures = await this.validateFeatures(
        features,
        strictMode
      );

      // Save features to database and get them back with IDs
      const savedFeatures = await this.saveFeatures(validatedFeatures);

      // Check consistency with existing features
      if (options?.checkConsistency !== false) {
        const consistencyIssues =
          await this.consistencyChecker.checkConsistency(jobId);
        if (consistencyIssues.summary.errors > 0) {
          this.logger.warn(
            `Found ${consistencyIssues.summary.errors} consistency errors for job ${jobId}`
          );
        }
      }

      // Only log in development
      if (process.env.NODE_ENV !== "production") {
        this.logger.log(
          `Extracted ${savedFeatures.length} validated features for job ${jobId} (${validatedFeatures.length - savedFeatures.length} filtered)`
        );
      }
      return savedFeatures;
    } catch (error) {
      this.logger.error(
        `Feature extraction failed for job ${jobId}:`,
        error.message
      );
      throw error;
    }
  }

  private async convertToFeatures(
    jobId: string,
    sheetId: string,
    analysis: VisionAnalysisResult,
    targets: string[],
    options?: any
  ): Promise<any[]> {
    const features = [];
    const verticalContext = this.buildVerticalContext(
      analysis,
      sheetId,
      options
    );

    // Convert rooms
    if (targets.includes("rooms")) {
      for (const room of analysis.rooms) {
        features.push({
          jobId,
          sheetId,
          type: "ROOM",
          props: {
            name: room.name,
            program: room.program,
            level: room.level || verticalContext.defaultLevel,
            heightFt:
              this.toNumber(room.heightFt) || verticalContext.defaultHeightFt,
          },
          area: this.toNumber(room.area),
          count: 1,
          // geom would be PostGIS geometry in real implementation
        });
      }
    }

    // Convert walls
    if (targets.includes("walls")) {
      for (const wall of analysis.walls) {
        features.push({
          jobId,
          sheetId,
          type: "WALL",
          props: {
            partitionType: wall.partitionType,
            level: wall.level || verticalContext.defaultLevel,
            heightFt:
              this.toNumber(wall.heightFt) || verticalContext.defaultHeightFt,
          },
          length: this.toNumber(wall.length),
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert openings (doors/windows)
    if (targets.includes("doors") || targets.includes("windows")) {
      for (const opening of analysis.openings) {
        features.push({
          jobId,
          sheetId,
          type: "OPENING",
          props: {
            openingType: opening.type,
            width: this.toNumber(opening.width),
            height: this.toNumber(opening.height),
            level: opening.level || verticalContext.defaultLevel,
          },
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert pipes
    if (targets.includes("pipes")) {
      for (const pipe of analysis.pipes) {
        features.push({
          jobId,
          sheetId,
          type: "PIPE",
          props: {
            service: pipe.service,
            diameterIn: this.toNumber(pipe.diameter),
            level: pipe.level || verticalContext.defaultLevel,
            heightFt:
              this.toNumber(pipe.heightFt) || verticalContext.defaultHeightFt,
          },
          length: this.toNumber(pipe.length),
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert ducts
    if (targets.includes("ducts")) {
      for (const duct of analysis.ducts) {
        features.push({
          jobId,
          sheetId,
          type: "DUCT",
          props: {
            size: duct.size,
            level: duct.level || verticalContext.defaultLevel,
            heightFt:
              this.toNumber(duct.heightFt) || verticalContext.defaultHeightFt,
          },
          length: this.toNumber(duct.length),
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert fixtures
    if (targets.includes("fixtures")) {
      for (const fixture of analysis.fixtures) {
        features.push({
          jobId,
          sheetId,
          type: "FIXTURE",
          props: {
            fixtureType: fixture.type,
            level: fixture.level || verticalContext.defaultLevel,
            heightFt:
              this.toNumber(fixture.heightFt) ||
              verticalContext.defaultHeightFt,
          },
          count: this.toNumber(fixture.count) || fixture.count,
          // geom would be PostGIS geometry
        });
      }
    }

    if (targets.includes("levels") && verticalContext.levels.length > 0) {
      for (const level of verticalContext.levels) {
        features.push({
          jobId,
          sheetId,
          type: "LEVEL",
          props: {
            name: level.name,
            elevationFt: level.elevationFt,
            heightFt:
              this.toNumber(level.heightFt) || verticalContext.defaultHeightFt,
          },
          count: 1,
        });
      }
    }

    if (
      targets.includes("elevations") &&
      (analysis.elevations?.length || 0) > 0
    ) {
      for (const elevation of analysis.elevations || []) {
        features.push({
          jobId,
          sheetId,
          type: "ELEVATION",
          props: {
            face: elevation.face,
            fromLevel: elevation.fromLevel || verticalContext.defaultLevel,
            toLevel: elevation.toLevel,
            heightFt:
              this.toNumber(elevation.heightFt) ||
              verticalContext.defaultHeightFt,
            notes: elevation.notes,
          },
          length: this.toNumber(elevation.widthFt),
          count: 1,
        });
      }
    }

    if (targets.includes("sections") && (analysis.sections?.length || 0) > 0) {
      for (const section of analysis.sections || []) {
        features.push({
          jobId,
          sheetId,
          type: "SECTION",
          props: {
            description: section.description,
            fromLevel: section.fromLevel || verticalContext.defaultLevel,
            toLevel: section.toLevel,
            heightFt:
              this.toNumber(section.heightFt) ||
              verticalContext.defaultHeightFt,
          },
          length: this.toNumber(section.heightFt),
          count: 1,
        });
      }
    }

    if (targets.includes("risers") && (analysis.risers?.length || 0) > 0) {
      for (const riser of analysis.risers || []) {
        features.push({
          jobId,
          sheetId,
          type: "RISER",
          props: {
            system: riser.system,
            levels:
              riser.levels || [verticalContext.defaultLevel].filter(Boolean),
          },
          length:
            this.toNumber(riser.heightFt) || verticalContext.defaultHeightFt,
          count: this.toNumber(riser.qty) || 1,
        });
      }
    }

    // Extract materials if available - store in props for now (can be processed by materials service later)
    // Materials are extracted but not stored as separate features - they'll be processed by materials extraction service

    return features;
  }

  private async updateSheetScale(
    sheetId: string,
    scale: VisionAnalysisResult["scale"],
    jobId?: string
  ): Promise<void> {
    if (!scale || !sheetId) return;

    try {
      // Resolve sheetId if it's a page index (string number) rather than a database ID
      let resolvedSheetId = sheetId;
      if (jobId) {
        const resolved = await this.resolveSheetId(jobId, sheetId);
        if (resolved) {
          resolvedSheetId = resolved;
        } else {
          // If we can't resolve it, try to find by index
          const sheetIndex = Number(sheetId);
          if (!Number.isNaN(sheetIndex) && jobId) {
            const sheet = await this.prisma.sheet.findFirst({
              where: { jobId, index: sheetIndex },
              select: { id: true },
            });
            if (sheet) {
              resolvedSheetId = sheet.id;
            } else {
              this.logger.warn(
                `Cannot resolve sheet ID for sheetId: ${sheetId}, jobId: ${jobId}`
              );
              return;
            }
          } else {
            this.logger.warn(
              `Cannot resolve sheet ID for sheetId: ${sheetId}, jobId: ${jobId}`
            );
            return;
          }
        }
      }

      // Check if sheet exists before updating
      const existingSheet = await this.prisma.sheet.findUnique({
        where: { id: resolvedSheetId },
        select: { id: true },
      });

      if (!existingSheet) {
        this.logger.warn(
          `Sheet not found for ID: ${resolvedSheetId} (original: ${sheetId})`
        );
        return;
      }

      await this.prisma.sheet.update({
        where: { id: resolvedSheetId },
        data: {
          scale: scale.detected,
          units: scale.units,
          scaleRatio: scale.ratio,
        } as any,
      });
      // Only log in development
      if (process.env.NODE_ENV !== "production") {
        this.logger.log(
          `Updated sheet ${resolvedSheetId} with scale: ${scale.detected} (ratio: ${scale.ratio})`
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to update sheet scale: ${error.message}`);
    }
  }

  private async validateFeatures(
    features: any[],
    strictMode: boolean
  ): Promise<any[]> {
    const validatedFeatures = [];
    let filteredCount = 0;

    for (const feature of features) {
      const validation = this.validationService.validateFeature(
        feature,
        strictMode
      );

      // Add validation metadata to feature
      feature.validation = {
        isValid: validation.isValid,
        confidence: validation.confidence,
        issues: validation.issues,
        warnings: validation.warnings,
      };

      // In strict mode, reject features with errors or low confidence
      if (strictMode) {
        if (!validation.isValid || validation.confidence < 0.7) {
          this.logger.debug(
            `Rejecting feature ${feature.id || "unknown"} in strict mode: ${validation.issues.map((i) => i.message).join(", ")}`
          );
          filteredCount++;
          continue;
        }
      }

      // Add provenance if not present
      if (!feature.provenance) {
        feature.provenance = {
          extractionMethod: "openai_vision",
          confidence: validation.confidence,
          timestamp: new Date().toISOString(),
        };
      }

      validatedFeatures.push(feature);
    }

    if (filteredCount > 0) {
      // Only log in development
      if (process.env.NODE_ENV !== "production") {
        this.logger.log(
          `Filtered ${filteredCount} features due to validation failures`
        );
      }
    }

    return validatedFeatures;
  }

  private buildVerticalContext(
    analysis: VisionAnalysisResult,
    sheetId: string,
    options?: any
  ): {
    defaultHeightFt: number;
    defaultLevel?: string;
    levels: Array<{
      id: string;
      name: string;
      elevationFt?: number;
      heightFt?: number;
    }>;
    levelMap: Map<
      string,
      { id: string; name: string; elevationFt?: number; heightFt?: number }
    >;
  } {
    const sheetOverride = this.getSheetOverride(sheetId, options);
    const levelMap = new Map<
      string,
      { id: string; name: string; elevationFt?: number; heightFt?: number }
    >();

    const addLevel = (
      level: {
        id?: string;
        name?: string;
        elevationFt?: number;
        heightFt?: number;
      },
      idxPrefix = "lvl"
    ) => {
      const key = level.name || level.id || `${idxPrefix}-${levelMap.size}`;
      levelMap.set(key, {
        id: level.id || key,
        name: level.name || key,
        elevationFt: level.elevationFt,
        heightFt: level.heightFt,
      });
    };

    analysis.levels?.forEach((level) => addLevel(level));

    sheetOverride?.levels?.forEach((name: string, index: number) => {
      if (!levelMap.has(name)) {
        addLevel({ id: `sheet-${index}`, name }, "sheet");
      }
    });

    if (options?.levelOverrides) {
      Object.entries(options.levelOverrides).forEach(
        ([name, elevationFt], index) => {
          const existing = levelMap.get(name);
          levelMap.set(name, {
            id: existing?.id || `override-${index}`,
            name,
            elevationFt:
              typeof elevationFt === "number" ? elevationFt : undefined,
            heightFt: existing?.heightFt,
          });
        }
      );
    }

    const levels = Array.from(levelMap.values());
    const defaultLevel = sheetOverride?.levels?.[0] || levels[0]?.name;
    const defaultHeightFt =
      sheetOverride?.defaultStoryHeightFt ??
      analysis.verticalMetadata?.defaultStoryHeightFt ??
      (defaultLevel ? levelMap.get(defaultLevel)?.heightFt : undefined) ??
      options?.defaultStoryHeightFt ??
      10;

    return {
      defaultHeightFt,
      defaultLevel,
      levels,
      levelMap,
    };
  }

  private getSheetOverride(sheetId: string, options?: any) {
    if (!options?.sheetOverrides) {
      return undefined;
    }

    return (
      options.sheetOverrides[sheetId] ||
      options.sheetOverrides[`page_${sheetId}`] ||
      options.sheetOverrides.default ||
      options.sheetOverrides["*"]
    );
  }

  private toNumber(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^\d.-]/g, "");
      if (!cleaned) return undefined;
      const parsed = parseFloat(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private async saveFeatures(features: any[]): Promise<any[]> {
    // First, deduplicate features within this batch
    const deduplicatedFeatures = this.deduplicateFeatures(features);
    
    if (deduplicatedFeatures.length < features.length) {
      this.logger.log(
        `Deduplicated ${features.length - deduplicatedFeatures.length} features within batch`
      );
    }
    
    const savedFeatures = [];
    for (const feature of deduplicatedFeatures) {
      const resolvedSheetId = await this.resolveSheetId(
        feature.jobId,
        feature.sheetId
      );

      // Check for existing similar feature (cross-sheet deduplication)
      const existingFeature = await this.findExistingFeature(feature, resolvedSheetId);
      
      if (existingFeature) {
        // Feature already exists - skip or merge
        this.logger.debug(
          `Skipping duplicate ${feature.type} feature (existing: ${existingFeature.id})`
        );
        continue;
      }

      const saved = await this.prisma.feature.create({
        data: {
          jobId: feature.jobId,
          sheetId: resolvedSheetId,
          type: feature.type,
          props: feature.props,
          area: feature.area,
          length: feature.length,
          count: feature.count,
          provenance: feature.provenance,
          validation: feature.validation,
          // geom: feature.geom, // Would be PostGIS geometry
        } as any,
      });

      // Return saved feature with ID and all original properties
      savedFeatures.push({
        ...feature,
        id: saved.id,
      });
    }
    return savedFeatures;
  }

  /**
   * Deduplicate features within a batch (same extraction run)
   * This handles cases where the same element is extracted multiple times
   */
  private deduplicateFeatures(features: any[]): any[] {
    const seen = new Map<string, any>();
    
    for (const feature of features) {
      const key = this.getFeatureDeduplicationKey(feature);
      
      if (seen.has(key)) {
        const existing = seen.get(key);
        // Keep the feature with more data (longer length, larger area, higher count)
        const existingScore = this.getFeatureDataScore(existing);
        const newScore = this.getFeatureDataScore(feature);
        
        if (newScore > existingScore) {
          seen.set(key, feature);
        }
      } else {
        seen.set(key, feature);
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Generate a key for deduplication based on feature type and properties
   */
  private getFeatureDeduplicationKey(feature: any): string {
    const type = feature.type || 'UNKNOWN';
    
    switch (type) {
      case 'ROOM':
        // Dedupe rooms by name (normalized)
        const roomName = (feature.props?.name || '').toLowerCase().trim();
        return `ROOM:${roomName}`;
        
      case 'WALL':
        // Dedupe walls by partition type and length (within tolerance)
        const partitionType = feature.props?.partitionType || 'UNKNOWN';
        const wallLength = Math.round((feature.length || 0) * 10) / 10; // Round to 0.1 LF
        return `WALL:${partitionType}:${wallLength}`;
        
      case 'PIPE':
        // Dedupe pipes by service, diameter, and length
        const pipeService = feature.props?.service || 'UNKNOWN';
        const diameter = feature.props?.diameterIn || 0;
        const pipeLength = Math.round((feature.length || 0) * 10) / 10;
        return `PIPE:${pipeService}:${diameter}:${pipeLength}`;
        
      case 'DUCT':
        // Dedupe ducts by size and length
        const ductSize = feature.props?.size || 'UNKNOWN';
        const ductLength = Math.round((feature.length || 0) * 10) / 10;
        return `DUCT:${ductSize}:${ductLength}`;
        
      case 'FIXTURE':
        // Dedupe fixtures by type (aggregate counts)
        const fixtureType = (feature.props?.fixtureType || 'UNKNOWN').toLowerCase().trim();
        return `FIXTURE:${fixtureType}`;
        
      default:
        // Default: use type + stringified props (less aggressive deduplication)
        return `${type}:${JSON.stringify(feature.props)}`;
    }
  }

  /**
   * Calculate a "data score" for a feature - higher is better/more complete
   */
  private getFeatureDataScore(feature: any): number {
    let score = 0;
    
    // Area contributes to score
    if (feature.area && feature.area > 0) score += feature.area;
    
    // Length contributes to score  
    if (feature.length && feature.length > 0) score += feature.length * 10;
    
    // Count contributes to score
    if (feature.count && feature.count > 0) score += feature.count * 100;
    
    // Props completeness
    if (feature.props) {
      score += Object.values(feature.props).filter(v => v != null).length * 10;
    }
    
    return score;
  }

  /**
   * Find an existing feature in the database that matches (cross-sheet deduplication)
   */
  private async findExistingFeature(feature: any, resolvedSheetId?: string): Promise<any | null> {
    const type = feature.type || 'UNKNOWN';
    
    // Only check for certain feature types that commonly get duplicated across sheets
    if (!['ROOM', 'FIXTURE'].includes(type)) {
      // For walls/pipes/ducts, allow same elements on different sheets
      // (they might legitimately appear on multiple sheet types)
      return null;
    }
    
    try {
      switch (type) {
        case 'ROOM':
          // Check for room with same name in same job
          const roomName = feature.props?.name;
          if (!roomName) return null;
          
          return await this.prisma.feature.findFirst({
            where: {
              jobId: feature.jobId,
              type: 'ROOM',
              props: {
                path: ['name'],
                equals: roomName
              }
            }
          });
          
        case 'FIXTURE':
          // For fixtures, we want to aggregate counts, not dedupe
          // But we should check for exact duplicates (same type, same sheet)
          const fixtureType = feature.props?.fixtureType;
          if (!fixtureType || !resolvedSheetId) return null;
          
          return await this.prisma.feature.findFirst({
            where: {
              jobId: feature.jobId,
              sheetId: resolvedSheetId,
              type: 'FIXTURE',
              props: {
                path: ['fixtureType'],
                equals: fixtureType
              }
            }
          });
          
        default:
          return null;
      }
    } catch (error) {
      // If query fails (e.g., JSON path not supported), just allow the feature
      this.logger.debug(`Feature lookup failed: ${error.message}`);
      return null;
    }
  }

  private async resolveSheetId(
    jobId: string,
    sheetRef?: string
  ): Promise<string | undefined> {
    if (!sheetRef) {
      return undefined;
    }

    let cache = this.sheetIdCache.get(jobId);
    if (!cache) {
      cache = new Map();
      this.sheetIdCache.set(jobId, cache);
    }

    if (cache.has(sheetRef)) {
      return cache.get(sheetRef) || undefined;
    }

    // First try direct ID match
    const direct = await this.prisma.sheet.findFirst({
      where: { id: sheetRef, jobId },
      select: { id: true },
    });

    if (direct) {
      cache.set(sheetRef, direct.id);
      return direct.id;
    }

    // Fallback: treat the ref as a sheet index (stringified number)
    const sheetIndex = Number(sheetRef);
    if (!Number.isNaN(sheetIndex)) {
      const byIndex = await this.prisma.sheet.findFirst({
        where: { jobId, index: sheetIndex },
        select: { id: true },
      });

      if (byIndex) {
        cache.set(sheetRef, byIndex.id);
        return byIndex.id;
      }
    }

    cache.set(sheetRef, null); // remember unresolved refs
    return undefined;
  }

  async enhanceWithAI(features: any[], context: string): Promise<any[]> {
    // Use OpenAI to enhance feature data with additional insights
    try {
      const enhancementPrompt = `Given these extracted building features, provide additional technical insights:

Features: ${JSON.stringify(features, null, 2)}
Context: ${context}

Enhance with:
- Material specifications
- Code compliance notes
- Design recommendations
- Quantity validation
- Missing element detection

Return enhanced features with additional properties.`;

      const response = await this.openaiVision.analyzeText(
        enhancementPrompt,
        "Feature Enhancement"
      );

      // Merge AI insights with existing features
      return this.mergeAIInsights(features, response);
    } catch (error) {
      this.logger.warn("AI enhancement failed:", error.message);
      return features; // Return original features if enhancement fails
    }
  }

  private mergeAIInsights(originalFeatures: any[], aiInsights: any): any[] {
    // Merge AI-generated insights with extracted features
    return originalFeatures.map((feature, index) => {
      const insights = aiInsights.features?.[index] || {};

      return {
        ...feature,
        props: {
          ...feature.props,
          ...insights.additionalProperties,
        },
        aiInsights: {
          recommendations: insights.recommendations,
          codeCompliance: insights.codeCompliance,
          materialSuggestions: insights.materialSuggestions,
        },
      };
    });
  }
}
