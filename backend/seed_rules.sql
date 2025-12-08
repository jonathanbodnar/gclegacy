INSERT INTO materials_rule_sets (id, name, version, rules, "createdAt", "updatedAt")
VALUES (
  'default-rules-v1',
  'Standard Commercial Rules',
  '1.0',
  '{
    "version": 1,
    "units": {"linear": "ft", "area": "ft2"},
    "vars": {
      "wall_height": 9,
      "perimeter_ratio": 0.4,
      "waste_floor": 1.07,
      "waste_paint": 1.15,
      "waste_ceiling": 1.05
    },
    "rules": [
      {"when": {"feature": "room"}, "materials": [
        {"sku": "ARM-EXCELON-51910", "qty": "area * waste_floor", "uom": "SF", "description": "Armstrong Excelon VCT Flooring"},
        {"sku": "SW-7006-PAINT", "qty": "area * perimeter_ratio * waste_paint", "uom": "SF", "description": "Interior Paint"},
        {"sku": "ARM-CIRRUS-ACT", "qty": "area * waste_ceiling", "uom": "SF", "description": "ACT Ceiling Tiles"},
        {"sku": "RUBBER-BASE-4IN", "qty": "area * perimeter_ratio", "uom": "LF", "description": "Rubber Base Molding"}
      ]},
      {"when": {"feature": "wall"}, "materials": [
        {"sku": "STUD-362-20GA", "qty": "length * 0.75", "uom": "LF", "description": "Metal Studs 3-5/8 20GA"},
        {"sku": "GWB-58-TYPEX", "qty": "length * wall_height * 2 / 32", "uom": "SHT", "description": "5/8 Type X Gypsum Board"},
        {"sku": "JOINT-COMPOUND", "qty": "length * wall_height * 0.05", "uom": "GAL", "description": "Joint Compound"},
        {"sku": "DRYWALL-TAPE", "qty": "length * 1.1", "uom": "LF", "description": "Drywall Tape"}
      ]},
      {"when": {"feature": "opening"}, "materials": [
        {"sku": "DOOR-FRAME-HM", "qty": "count", "uom": "EA", "description": "Hollow Metal Door Frame"},
        {"sku": "DOOR-SOLID-SC", "qty": "count", "uom": "EA", "description": "Solid Core Door"},
        {"sku": "HARDWARE-SET", "qty": "count", "uom": "SET", "description": "Door Hardware Set"}
      ]},
      {"when": {"feature": "pipe"}, "materials": [
        {"sku": "PIPE-COPPER-L", "qty": "length", "uom": "LF", "description": "Copper Pipe Type L"},
        {"sku": "PIPE-FITTING", "qty": "length * 0.1", "uom": "EA", "description": "Pipe Fittings"},
        {"sku": "PIPE-HANGER", "qty": "length / 4", "uom": "EA", "description": "Pipe Hangers"},
        {"sku": "PIPE-INSUL", "qty": "length", "uom": "LF", "description": "Pipe Insulation"}
      ]},
      {"when": {"feature": "duct"}, "materials": [
        {"sku": "DUCT-GALV-RECT", "qty": "length", "uom": "LF", "description": "Galvanized Ductwork"},
        {"sku": "DUCT-FITTING", "qty": "length * 0.15", "uom": "EA", "description": "Duct Fittings"},
        {"sku": "DUCT-HANGER", "qty": "length / 5", "uom": "EA", "description": "Duct Hangers"},
        {"sku": "DUCT-INSUL", "qty": "length * 2", "uom": "SF", "description": "Duct Insulation"}
      ]},
      {"when": {"feature": "fixture"}, "materials": [
        {"sku": "FIXTURE-UNIT", "qty": "count", "uom": "EA", "description": "Plumbing/Electrical Fixture"},
        {"sku": "FIXTURE-CONN", "qty": "count * 2", "uom": "EA", "description": "Fixture Connections"},
        {"sku": "FIXTURE-MOUNT", "qty": "count", "uom": "EA", "description": "Mounting Hardware"}
      ]}
    ]
  }'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO materials_rule_sets (id, name, version, rules, "createdAt", "updatedAt")
VALUES (
  'residential-rules-v1',
  'Residential Rules',
  '1.0',
  '{
    "version": 1,
    "units": {"linear": "ft", "area": "ft2"},
    "vars": {"wall_height": 8, "perimeter_ratio": 0.35, "waste_floor": 1.05, "waste_paint": 1.10, "waste_ceiling": 1.03},
    "rules": [
      {"when": {"feature": "room"}, "materials": [
        {"sku": "HARDWOOD-OAK", "qty": "area * waste_floor", "uom": "SF", "description": "Oak Hardwood Flooring"},
        {"sku": "INT-PAINT-FLAT", "qty": "area * perimeter_ratio * waste_paint", "uom": "SF", "description": "Interior Flat Paint"},
        {"sku": "DRYWALL-CEILING", "qty": "area * waste_ceiling", "uom": "SF", "description": "Drywall Ceiling"},
        {"sku": "WOOD-BASE-3IN", "qty": "area * perimeter_ratio", "uom": "LF", "description": "Wood Base Molding"}
      ]},
      {"when": {"feature": "wall"}, "materials": [
        {"sku": "STUD-WOOD-2X4", "qty": "length * 0.75", "uom": "LF", "description": "Wood Studs 2x4 @ 16 OC"},
        {"sku": "GWB-12-REG", "qty": "length * wall_height * 2 / 32", "uom": "SHT", "description": "1/2 Regular Drywall"}
      ]},
      {"when": {"feature": "opening"}, "materials": [
        {"sku": "DOOR-FRAME-WOOD", "qty": "count", "uom": "EA", "description": "Wood Door Frame"},
        {"sku": "DOOR-HOLLOW", "qty": "count", "uom": "EA", "description": "Hollow Core Door"},
        {"sku": "HARDWARE-RES", "qty": "count", "uom": "SET", "description": "Residential Hardware"}
      ]},
      {"when": {"feature": "pipe"}, "materials": [
        {"sku": "PEX-PIPE", "qty": "length", "uom": "LF", "description": "PEX Pipe"},
        {"sku": "PEX-FITTING", "qty": "length * 0.08", "uom": "EA", "description": "PEX Fittings"}
      ]},
      {"when": {"feature": "duct"}, "materials": [
        {"sku": "FLEX-DUCT", "qty": "length", "uom": "LF", "description": "Flexible Ductwork"},
        {"sku": "DUCT-STRAP", "qty": "length / 3", "uom": "EA", "description": "Duct Straps"}
      ]},
      {"when": {"feature": "fixture"}, "materials": [
        {"sku": "FIXTURE-RES", "qty": "count", "uom": "EA", "description": "Residential Fixture"},
        {"sku": "FIXTURE-SUPPLY", "qty": "count", "uom": "EA", "description": "Supply Lines"}
      ]}
    ]
  }'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
