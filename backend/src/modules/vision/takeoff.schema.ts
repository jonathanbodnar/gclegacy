export const TAKEOFF_JSON_SCHEMA = {
  type: 'object',
  required: ['project', 'sheets', 'levels', 'rooms', 'walls', 'electrical', 'meta'],
  properties: {
    project: {
      type: 'object',
      required: ['name', 'number', 'address', 'total_area_sqft', 'client', 'notes'],
      properties: {
        name: { type: ['string', 'null'] },
        number: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        total_area_sqft: { type: ['number', 'null'] },
        client: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'number', 'scale', 'pixelsPerFoot', 'scaleSource', 'disciplines'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          number: { type: 'string' },
          scale: { type: ['string', 'null'] },
          pixelsPerFoot: { type: ['number', 'null'] },
          scaleSource: {
            type: ['string', 'null'],
            enum: ['dimension-calibration', 'title-block', 'fallback', null],
          },
          disciplines: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    },
    levels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'elevation_ft', 'height_ft', 'reference_sheet', 'ceiling_heights'],
        properties: {
          name: { type: 'string' },
          elevation_ft: { type: ['number', 'null'] },
          height_ft: { type: ['number', 'null'] },
          reference_sheet: { type: ['string', 'null'] },
          ceiling_heights: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              required: ['room_number', 'height_ft', 'heightSource'],
              properties: {
                room_number: { type: ['string', 'null'] },
                height_ft: { type: ['number', 'null'] },
                heightSource: {
                  type: ['string', 'null'],
                  enum: ['rcp', 'schedule', 'assumption', null],
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'name', 'level', 'sheet_refs', 'approx_area_sqft', 'area_source', 'finish', 'bounding_box_px', 'centroid_px', 'confidence', 'notes'],
        properties: {
          number: { type: 'string' },
          name: { type: 'string' },
          level: { type: ['string', 'null'] },
          sheet_refs: {
            type: ['array', 'null'],
            items: { type: 'string' },
          },
          approx_area_sqft: { type: ['number', 'null'] },
          area_source: {
            type: ['string', 'null'],
            enum: ['printed', 'computed', 'assumed', null],
          },
          finish: {
            type: ['object', 'null'],
            required: ['floor', 'walls', 'ceiling', 'base'],
            properties: {
              floor: { type: ['string', 'null'] },
              walls: {
                type: ['array', 'null'],
                items: { type: 'string' },
              },
              ceiling: { type: ['string', 'null'] },
              base: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
          bounding_box_px: {
            type: ['array', 'null'],
            items: { type: 'number' },
            minItems: 4,
            maxItems: 4,
          },
          centroid_px: {
            type: ['array', 'null'],
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
          },
          confidence: { type: ['number', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'partition_type', 'new_or_existing', 'from_room', 'to_room', 'length_ft', 'height_ft', 'heightSource', 'polyline_px', 'notes'],
        properties: {
          id: { type: 'string' },
          partition_type: { type: ['string', 'null'] },
          new_or_existing: { type: ['string', 'null'], enum: ['new', 'existing', 'demo', null] },
          from_room: { type: ['string', 'null'] },
          to_room: { type: ['string', 'null'] },
          length_ft: { type: ['number', 'null'] },
          height_ft: { type: ['number', 'null'] },
          heightSource: { type: ['string', 'null'], enum: ['rcp', 'assumption', null] },
          polyline_px: {
            type: ['array', 'null'],
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
            },
          },
          notes: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
    electrical: {
      type: ['object', 'null'],
      required: ['panel', 'circuits'],
      properties: {
        panel: {
          type: ['object', 'null'],
          required: ['x', 'y', 'sheet'],
          properties: {
            x: { type: ['number', 'null'] },
            y: { type: ['number', 'null'] },
            sheet: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        circuits: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['type', 'count', 'runFt', 'wire', 'conduit', 'confidence', 'notes'],
            properties: {
              type: { type: 'string' },
              count: { type: 'number' },
              runFt: { type: 'number' },
              wire: { type: 'string' },
              conduit: { type: 'string' },
              confidence: { type: 'number' },
              notes: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    meta: {
      type: 'object',
      required: ['units', 'version', 'generatedAt'],
      properties: {
        units: {
          type: 'object',
          required: ['linear', 'area'],
          properties: {
            linear: { type: 'string' },
            area: { type: 'string' },
          },
          additionalProperties: false,
        },
        version: { type: 'string' },
        generatedAt: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
