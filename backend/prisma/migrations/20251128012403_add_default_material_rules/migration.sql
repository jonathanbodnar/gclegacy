-- Insert default "Standard Commercial Rules v1.0" rule set
INSERT INTO "materials_rule_sets" ("id", "name", "version", "rules", "createdAt", "updatedAt")
VALUES (
  'default-rules-v1',
  'Standard Commercial Rules',
  '1.0',
  '{
    "version": 1,
    "units": {
      "linear": "ft",
      "area": "ft2"
    },
    "vars": {
      "vct_price": 3.85,
      "paint_price_sf": 0.45,
      "act_ceiling_price": 2.5,
      "rubber_base_lf": 1.25,
      "waste_floor": 1.07,
      "waste_paint": 1.15,
      "waste_ceiling": 1.05,
      "wall_height": 9,
      "perimeter_ratio": 0.4
    },
    "rules": [
      {
        "when": {
          "feature": "room"
        },
        "materials": [
          {
            "sku": "ARM-EXCELON-51910",
            "qty": "area * waste_floor",
            "uom": "SF",
            "description": "Armstrong Excelon VCT Flooring (12x12)"
          },
          {
            "sku": "SW-7006-PAINT",
            "qty": "area * perimeter_ratio * waste_paint",
            "uom": "SF",
            "description": "Sherwin Williams Extra White Interior Paint (walls)"
          },
          {
            "sku": "ARM-CIRRUS-ACT",
            "qty": "area * waste_ceiling",
            "uom": "SF",
            "description": "Armstrong Cirrus 2x2 ACT Ceiling Tiles"
          },
          {
            "sku": "RUBBER-BASE-4IN",
            "qty": "area * perimeter_ratio",
            "uom": "LF",
            "description": "4-inch Rubber Base Molding"
          }
        ]
      },
      {
        "when": {
          "feature": "wall"
        },
        "materials": [
          {
            "sku": "STUD-362-20GA",
            "qty": "length * 0.75",
            "uom": "LF",
            "description": "Metal Studs 3-5/8\" 20GA @ 16\" OC"
          },
          {
            "sku": "GWB-58-TYPEX",
            "qty": "length * wall_height * 2 / 32",
            "uom": "SHT",
            "description": "5/8\" Type X Gypsum Board (both sides, 4x8 sheets)"
          }
        ]
      },
      {
        "when": {
          "feature": "pipe"
        },
        "materials": [
          {
            "sku": "PIPE-COPPER-TYPEL",
            "qty": "length",
            "uom": "LF",
            "description": "Copper Pipe Type L"
          }
        ]
      },
      {
        "when": {
          "feature": "duct"
        },
        "materials": [
          {
            "sku": "DUCT-GALV-RECT",
            "qty": "length",
            "uom": "LF",
            "description": "Galvanized Rectangular Ductwork"
          }
        ]
      }
    ]
  }'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name", "version") 
DO UPDATE SET 
  "rules" = EXCLUDED."rules",
  "updatedAt" = CURRENT_TIMESTAMP;

