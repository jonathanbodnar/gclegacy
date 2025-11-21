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
    this.logger.log(`Extracting features for job ${jobId}, sheet ${sheetId}`);

    try {
      const strictMode =
        options?.zeroHallucinationMode === true || options?.strictMode === true;

      // Update sheet with scale information if available
      if (analysisFeatures.scale) {
        await this.updateSheetScale(sheetId, analysisFeatures.scale);
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

      this.logger.log(
        `Extracted ${savedFeatures.length} validated features for job ${jobId} (${validatedFeatures.length - savedFeatures.length} filtered)`
      );
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
    scale: VisionAnalysisResult["scale"]
  ): Promise<void> {
    if (!scale || !sheetId) return;

    try {
      await this.prisma.sheet.update({
        where: { id: sheetId },
        data: {
          scale: scale.detected,
          units: scale.units,
          scaleRatio: scale.ratio,
        } as any,
      });
      this.logger.log(
        `Updated sheet ${sheetId} with scale: ${scale.detected} (ratio: ${scale.ratio})`
      );
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
      this.logger.log(
        `Filtered ${filteredCount} features due to validation failures`
      );
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
    const savedFeatures = [];
    for (const feature of features) {
      const resolvedSheetId = await this.resolveSheetId(
        feature.jobId,
        feature.sheetId
      );

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
