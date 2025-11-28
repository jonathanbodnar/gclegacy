import { Types } from 'mongoose';
import { JobDocument } from '../models/job.model';
import { SheetDocument, SheetModel } from '../models/sheet.model';
import { FeatureModel, FeatureType } from '../models/feature.model';
import { PageFeatureSet } from './openai-plan.service';
import { ValidationService } from './vision/validation.service';
import { ConsistencyCheckerService } from './vision/consistency-checker.service';

const normalizeNumber = (value?: number): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

export class FeatureExtractionService {
  private readonly validationService = new ValidationService();
  private readonly consistencyChecker = new ConsistencyCheckerService();

  async persist(job: JobDocument, pages: PageFeatureSet[]) {
    const sheetDocs: SheetDocument[] = [];
    const featureDocs: Array<{
      job: Types.ObjectId;
      sheet?: Types.ObjectId;
      type: FeatureType;
      props?: Record<string, unknown>;
      area?: number;
      length?: number;
      count?: number;
    }> = [];

    const sheetMap: Record<number, SheetDocument> = {};

    for (const page of pages) {
      const sheet = await SheetModel.findOneAndUpdate(
        { job: job._id, index: page.pageIndex },
        {
          $set: {
            name: page.sheetTitle || `Sheet ${page.pageIndex + 1}`,
            discipline: page.discipline,
            scale: page.scale,
            units: page.units,
            metadata: {
              notes: page.notes,
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).exec();
      sheetDocs.push(sheet);
      sheetMap[page.pageIndex] = sheet;

      page.rooms.forEach((room) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'ROOM',
          area: normalizeNumber(room.areaSqFt),
          props: {
            name: room.name,
            program: room.program,
            level: room.level,
            sourceId: room.id,
          },
        }),
      );

      page.walls.forEach((wall) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'WALL',
          length: normalizeNumber(wall.lengthFt),
          props: {
            partitionType: wall.partitionType,
            level: wall.level,
            heightFt: normalizeNumber(wall.heightFt),
            sourceId: wall.id,
          },
        }),
      );

      page.openings.forEach((opening) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'OPENING',
          props: {
            openingType: opening.openingType,
            widthFt: normalizeNumber(opening.widthFt),
            heightFt: normalizeNumber(opening.heightFt),
            sourceId: opening.id,
          },
        }),
      );

      page.pipes.forEach((pipe) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'PIPE',
          length: normalizeNumber(pipe.lengthFt),
          props: {
            service: pipe.service,
            diameterIn: normalizeNumber(pipe.diameterIn),
            sourceId: pipe.id,
          },
        }),
      );

      page.ducts.forEach((duct) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'DUCT',
          length: normalizeNumber(duct.lengthFt),
          props: {
            service: duct.service,
            size: duct.size,
            sourceId: duct.id,
          },
        }),
      );

      page.fixtures.forEach((fixture) =>
        featureDocs.push({
          job: job._id,
          sheet: sheet._id,
          type: 'FIXTURE',
          count: normalizeNumber(fixture.count) ?? 1,
          props: {
            fixtureType: fixture.fixtureType,
            service: fixture.service,
            sourceId: fixture.id,
          },
        }),
      );
    }

    const validatedDocs =
      featureDocs.length > 0
        ? featureDocs.filter((doc) => this.validationService.validateFeature(this.buildValidationPayload(doc)).isValid)
        : [];

    const createdFeatures =
      validatedDocs.length > 0
        ? await FeatureModel.insertMany(validatedDocs, { ordered: false })
        : [];

    if (createdFeatures.length > 0) {
      await this.consistencyChecker.checkConsistency(job._id.toString());
    }

    return {
      sheets: sheetDocs,
      features: createdFeatures,
    };
  }

  private buildValidationPayload(doc: {
    type: FeatureType;
    area?: number;
    length?: number;
    count?: number;
    props?: Record<string, unknown>;
  }) {
    return {
      type: doc.type,
      area: doc.area,
      length: doc.length,
      count: doc.count,
      props: doc.props,
    };
  }
}

