export const TAKEOFF_JSON_SCHEMA = {
  type: 'object',
  required: ['sheets', 'rooms', 'walls', 'electrical', 'meta'],
  properties: {
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
        },
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'area', 'areaSource', 'confidence'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          width: { type: ['number', 'null'] },
          length: { type: ['number', 'null'] },
          area: { type: 'number' },
          areaSource: { type: 'string', enum: ['printed', 'computed', 'missing'] },
          confidence: { type: 'number' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'length', 'confidence'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          length: { type: 'number' },
          height: { type: ['number', 'null'] },
          heightSource: { type: ['string', 'null'], enum: ['rcp', 'assumption', null] },
          areaSF: { type: ['number', 'null'] },
          confidence: { type: 'number' },
        },
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
          },
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
          },
        },
      },
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
        },
        version: { type: 'string' },
      },
    },
  },
} as const;
