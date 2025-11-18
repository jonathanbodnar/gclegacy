export const TAKEOFF_JSON_SCHEMA = {
  type: 'object',
  required: ['project', 'sheets', 'levels', 'rooms', 'walls', 'meta'],
  properties: {
    project: {
      type: 'object',
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
        required: ['id', 'name', 'number', 'scale', 'pixelsPerFoot', 'scaleSource'],
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
        required: ['name'],
        properties: {
          name: { type: 'string' },
          elevation_ft: { type: ['number', 'null'] },
          height_ft: { type: ['number', 'null'] },
          reference_sheet: { type: ['string', 'null'] },
          ceiling_heights: {
            type: 'array',
            items: {
              type: 'object',
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
        required: ['number', 'name'],
        properties: {
          number: { type: 'string' },
          name: { type: 'string' },
          level: { type: ['string', 'null'] },
          sheet_refs: {
            type: 'array',
            items: { type: 'string' },
          },
          approx_area_sqft: { type: ['number', 'null'] },
          area_source: {
            type: ['string', 'null'],
            enum: ['printed', 'computed', 'assumed', null],
          },
          finish: {
            type: ['object', 'null'],
            properties: {
              floor: { type: ['string', 'null'] },
              walls: {
                type: 'array',
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
        required: ['id'],
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
      type: 'object',
      required: ['panel', 'circuits'],
      properties: {
        panel: {
          type: ['object', 'null'],
          properties: {
            x: { type: ['number', 'null'] },
            y: { type: ['number', 'null'] },
            sheet: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        circuits: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'count', 'runFt', 'wire', 'conduit', 'confidence'],
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
      required: ['units', 'version'],
      properties: {
        units: {
          type: 'object',
          properties: {
            linear: { type: 'string' },
            area: { type: 'string' },
          },
          additionalProperties: false,
        },
        version: { type: 'string' },
        generatedAt: { type: ['string', 'null'], format: 'date-time' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
