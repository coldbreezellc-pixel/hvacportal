// Generated from the original pm/index.html by scripts in the migration session — the
// PPE, safety, equipment and PM task definitions the crew has been using. Edit here to
// change what the PM Sheet shows.

export const PPE_ITEMS: string[] = [
  "Safety Glasses",
  "Gloves",
  "Ear Protection",
  "Dust Mask/Respirator",
  "Safety Shoes",
  "Hard Hat"
];
export const PREJOB_TASKS: string[] = [
  "Review job order for specific hazards",
  "Inspect work area for tripping hazards",
  "Ensure adequate lighting",
  "Verify that all tools are in good condition",
  "Check the accessibility of fire extinguisher"
];
export const ELECTRICAL_TASKS: string[] = [
  "Ensure power is disconnected before starting work",
  "Use appropriate lockout/tagout procedures",
  "Inspect electrical cords and tools for damage",
  "Test for live wires using a non-contact voltage tester"
];
export const GAS_TASKS: string[] = [
  "Check for gas leaks using a gas detector",
  "Ensure proper ventilation in the work area",
  "Use refrigerant handling equipment according to EPA guidelines",
  "Store chemicals and gases according to manufacturer's instructions"
];
export const POSTJOB_TASKS: string[] = [
  "Clean work area and remove all debris",
  "Put away all tools",
  "Inspect installation or repair area",
  "Test Equipment operation",
  "Send Email Regarding Findings and completion"
];

export const SAFETY_SECTIONS: { key: string; label: string; items: string[] }[] = [
  { key: "ppe", label: "Personal Protective Equipment (PPE)", items: PPE_ITEMS },
  { key: "prejob", label: "Pre-Job Safety Checklist", items: PREJOB_TASKS },
  { key: "electrical", label: "Electrical Safety", items: ELECTRICAL_TASKS },
  { key: "gas", label: "Gas & Chemical Safety", items: GAS_TASKS },
];

export const EMERGENCY_PROCEDURES: { title: string; text: string }[] = [
  { title: "Electrical Shock", text: "Do not touch the person. Disconnect power source if possible and call the Chief and emergency services." },
  { title: "Gas Leak", text: "Evacuate the area immediately. Do not use electrical switches or open flames. Call the gas company from a safe distance." },
  { title: "Fire", text: "Use a fire extinguisher if safe to do so. Evacuate the area and call emergency services and Notify Chief and GRIC." },
  { title: "Chemical Spill", text: "Use appropriate PPE and clean-up materials. Refer to the Safety Data Sheet (SDS) for specific handling instructions." },
];

export const FACILITIES = ["900 Sylvan Ave, Englewood Cliffs", "904 Sylvan Ave, Englewood Cliffs"];
export const FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Repair"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type EquipmentGroups = Record<string, string[]>;
export const EQUIPMENT_SHARED: EquipmentGroups = {
  "Safety": [
    "CO Detectors"
  ]
};
export const EQUIPMENT_900: EquipmentGroups = {
  "Cooling Towers": [
    "Cooling Tower 1",
    "Cooling Tower 2",
    "Cooling Tower 3",
    "Cooling Tower 4"
  ],
  "PACO Pumps": [
    "PCWP 1",
    "PCWP 2",
    "PCWP 3",
    "PCWP 4",
    "SCWP 1",
    "SCWP 2",
    "SCWP 3",
    "SCWP 4",
    "CHWP 1",
    "CHWP 2",
    "CHWP 3",
    "CHWP 4"
  ],
  "Liebert Units": [
    "Liebert Unit",
    "Basement Liebert Units"
  ],
  "Air Handling": [
    "AHU Buffalo",
    "AHU Studio Units",
    "HV and Fan Units",
    "FCU",
    "GE Penthouse Unit",
    "Bard Unit"
  ],
  "Fans": [
    "Fan Exhaust",
    "Fan Exhaust Kitchen",
    "Fan Smoke Purge",
    "Filtration Make-Up"
  ],
  "Heaters": [
    "Stairwell Heater",
    "Hot Water Heater",
    "Domestic Hot Water System"
  ],
  "Other": [
    "Blowdown Penthouse"
  ],
  "Plumbing": [
    "Bathroom Hardware",
    "Bathroom Plumbing",
    "Drain Fitness Center"
  ],
  "Fountains": [
    "Fountain Courtyard",
    "Fountain Water Hall"
  ]
};
export const EQUIPMENT_904: EquipmentGroups = {
  "Air Handling": [
    "Bard Unit"
  ]
};

/** Equipment that can have several numbered units on one sheet. */
export const MULTI_UNIT_EQUIP = new Set<string>([
  "AHU Buffalo",
  "AHU Studio Units",
  "HV and Fan Units",
  "FCU",
  "GE Penthouse Unit",
  "Bard Unit",
  "Fan Exhaust",
  "Fan Exhaust Kitchen",
  "Fan Smoke Purge",
  "Filtration Make-Up",
  "Stairwell Heater",
  "Hot Water Heater",
  "Domestic Hot Water System",
  "Basement Liebert Units"
]);

export const CT_PM: Record<string, string[]> = {
  "Quarterly": [
    "Inspect general condition of Tower",
    "Inspect, clean cold water basin and basin filtration piping",
    "Ensure all basin filtration nozzles are in place and clear of debris",
    "Inspect domestic water make up system and adjust if necessary",
    "Inspect conduit distribution system and sprayers for proper operation",
    "Inspect fan blade bolts for tightness and stress cracks",
    "Inspect belts — adjust or replace if necessary",
    "Lubricate fan shaft bearings",
    "Lubricate fan motor adjusting rods",
    "Inspect all piping insulation and actuators"
  ],
  "Quarterly — VFD": [
    "Replace all VFD Filters — perform inventory after change",
    "Confirm proper operation of cooling fans",
    "Check all MCC indicator lights — replace if necessary"
  ],
  "Semi-Annual": [
    "Full tower cleaning",
    "Clean the outside of the fan motor to prevent overheating",
    "Inspect heat trace system and basin heaters (record amperes)",
    "Inspect all surfaces for corrosion and report findings",
    "Inspect galvanized components, wire brush and apply cold galvanize as necessary"
  ],
  "Annual": [
    "Open Balance Clean, remove strainer and clean it",
    "Megger the fan motor windings"
  ]
};
export const PUMP_PM: Record<string, { tasks: string[]; note?: string }> = {
  "Daily": {
    "tasks": [
      "Check if there are no leaks or seeping of condenser water at mechanical seals"
    ],
    "note": "This should be performed during building rounds every shift"
  },
  "Quarterly": {
    "tasks": [
      "Check for unusual noise or vibration",
      "Ensure motor and pump mounting bolts are snug",
      "Inspect pump and seals for water leaks",
      "Inspect drive coupling for wear (LOTO)",
      "Ensure drive coupling set screws are tight (LOTO)",
      "Check pump shaft for free rotation (LOTO)",
      "Inspect and test pressure gauges and cyclone separators",
      "Exercise all isolation valves — NOTE START POSITION BEFORE PROCEEDING"
    ]
  },
  "Semi-Annual": {
    "tasks": [
      "Measure and record motor amperage at 60 Hz",
      "Grease pump and motor — use Polyurea Grease",
      "Check bearings temperature before and after applying grease",
      "Inspect vibration eliminators and ensure base is floating",
      "Inspect drive coupling alignment (LOTO)"
    ],
    "note": "Refer to both O+M manuals (pump and motor) for lubrication quantities"
  }
};
export interface LiebertSection { sub: string; tasks: string[]; alert?: string; hasHeaterReadings?: boolean; hasMotorReadings?: boolean }
export const LIEBERT_PM: Record<string, { sections: LiebertSection[] }> = {
  "Monthly": {
    "sections": [
      {
        "sub": "Blower Section",
        "tasks": [
          "Clean and inspect blower wheel(s) for loose or cracked blades",
          "Bearings inspect for free movement, and check set screw for tightness",
          "Inspect belt condition and tension (replace if necessary) — USE LOTO"
        ]
      },
      {
        "sub": "Heaters",
        "tasks": [
          "Inspect heating elements for deterioration",
          "Engage heaters through the controller and confirm proper operation"
        ]
      },
      {
        "sub": "Air Filters",
        "tasks": [
          "Check air filter switch",
          "Wipe section clean including intake grills — report any damage to unit"
        ]
      },
      {
        "sub": "Condensate Pump",
        "tasks": [
          "Inspect mechanical pump operation",
          "Inspect all electrical connections"
        ]
      },
      {
        "sub": "CHW Piping",
        "tasks": [
          "Inspect all piping actuators for leaks and unrestricted movement (stroke via Test Outputs Menu)",
          "Inspect all CHW insulation — repair if necessary",
          "Inspect and test supply, return gauges and iso valves — replace if necessary",
          "Inspect and test all Belimo Actuators — report any issues to Chief immediately"
        ]
      }
    ]
  },
  "Semi-Annual": {
    "sections": [
      {
        "sub": "Blower Section",
        "tasks": [
          "Lubricate drive motor if serviceable (2 oz. every 3 years from initial PM date)",
          "Inspect and tighten electrical connections"
        ]
      },
      {
        "sub": "Strainers",
        "tasks": [
          "Blow down supply strainers",
          "Ensure there are no leaks, reinstall cap and make sure there are no leaks",
          "Top off chilled water via Penthouse"
        ]
      },
      {
        "sub": "Heaters",
        "tasks": [
          "Engage heaters through the controller and confirm proper operation",
          "Record amperes on each element and write down findings"
        ],
        "hasHeaterReadings": true
      },
      {
        "sub": "Air Filters",
        "tasks": [
          "Replace Air Filters"
        ]
      },
      {
        "sub": "CHW Piping + A Coil",
        "tasks": [
          "Inspect coil for any signs of leaks and rust/corrosion",
          "Clean condensate pan",
          "Repair and/or add insulation where necessary"
        ],
        "alert": "REPORT ANY AND ALL SIGNS OF CORROSION ON THE ENTIRE MACHINE"
      },
      {
        "sub": "Electrical",
        "tasks": [
          "Check Fuses",
          "Inspect and tighten all electrical connections",
          "Check operating sequence",
          "Check contactor operation and inspect contacts for pitting",
          "Check condition of drive motor and record amperes"
        ],
        "hasMotorReadings": true
      }
    ]
  }
};
export const CO_PM: Record<string, string[]> = {
  "Monthly": [
    "Notify Security you will be testing CO detectors and causing a local audible alert",
    "Press and hold test button on wall mounted detector until audible alert is heard"
  ],
  "Annual": [
    "Notify Security you will be testing CO detectors and causing a local audible alert",
    "Replace batteries using (1) 9V battery in each detector",
    "Press and hold test button on wall mounted detector until audible alert is heard"
  ]
};
export interface GenericPm { amps: boolean; ampLabels?: string[]; intervals: Record<string, string[]> }
export const GENERIC_PM: Record<string, GenericPm> = {
  "AHU Buffalo": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Check physical condition of blower section",
        "Check belt condition and tension — use belt checker, replace if necessary",
        "Inspect vibration eliminators — adjust if necessary",
        "Check all bearings, pulleys, and set screws for tightness",
        "Ensure condensate pan and drain are clean and clear of obstruction",
        "Inspect for any signs of algae or bacteria — REPORT ISSUES IMMEDIATELY",
        "VFD: Ensure proper operation of cooling fans — REPORT ISSUES IMMEDIATELY",
        "CHW: Blow down chilled water strainers",
        "CHW: Check proper operation via BMS",
        "CHW: Inspect all pressure gauges for proper operation — replace if necessary"
      ],
      "Semi-Annual": [
        "Clean and inspect blower wheel for loose or cracked blades",
        "Lubricate blower shaft bearings (REFER TO LUBE MASTER) — wipe excess grease from bearing after adding lube",
        "Lubricate motor if serviceable type (REFER TO LUBE MASTER)",
        "Inspect all electrical contactors for excessively burnt, corroded or pitted contacts",
        "Inspect air dampers for proper sealing — adjust if necessary",
        "Replace all 2\" Pre-Filters, box old ones and move to loading dock for removal",
        "Flush condensate drains with fresh water and ensure unrestricted flow",
        "Wipe down exterior of the unit",
        "Vacuum all exterior flood containment pans as well as the Air Handler Room Floors"
      ],
      "Annual": [
        "Check all Blower bearings, pulleys and set screws for tightness",
        "Inspect all electric wires for signs of overheating — replace if necessary"
      ]
    }
  },
  "AHU Studio Units": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Check physical condition of blower section",
        "Check belt condition and tension — use belt checker, replace if necessary",
        "Inspect vibration eliminators — adjust if necessary",
        "Check all bearings, pulleys, and set screws for tightness",
        "Ensure condensate pan and drain are clean and clear of obstruction",
        "VFD: Ensure proper operation of cooling fans — REPORT ISSUES IMMEDIATELY",
        "CHW: Blow down chilled water strainers",
        "CHW: Check proper operation via BMS",
        "Pour Chromate \"Lift\" into all floor drains in the Studio AHU Room"
      ],
      "Semi-Annual": [
        "Clean and inspect blower wheel for loose or cracked blades",
        "Lubricate blower shaft bearings (REFER TO LUBE MASTER)",
        "Lubricate motor if serviceable type (REFER TO LUBE MASTER)",
        "Inspect all electrical contactors for excessively burnt, corroded or pitted contacts",
        "Inspect air dampers for proper sealing — adjust if necessary",
        "Replace Air Filters",
        "Flush condensate drains with fresh water and ensure unrestricted flow",
        "Wipe down exterior of the unit",
        "Vacuum all exterior flood containment pans as well as the Air Handler Room Floors"
      ],
      "Annual": [
        "Check all Blower bearings, pulleys and set screws for tightness",
        "Inspect all electric wires for signs of overheating — replace if necessary",
        "Ensure all wire terminations are tight",
        "Remove, clean and apply never seize to chilled water strainers"
      ]
    }
  },
  "Bard Unit": {
    "amps": true,
    "ampLabels": [
      "Evap Fan",
      "Cond Fan",
      "Crankcase Htr",
      "Compressor"
    ],
    "intervals": {
      "Quarterly": [
        "Replace air filter",
        "Inspect Evaporator Fan operation — clean if necessary",
        "Record Evaporator Fan Amperes",
        "Inspect Condenser Fan operation — clean if necessary",
        "Record Condenser Fan Amperes",
        "Check Refrigerant Cycle (Evaporator Temp, Condenser Coil Temperature)",
        "Inspect for refrigerant leaks",
        "Check all contactors and controls",
        "Inspect Crankcase Heaters if Equipped (Record Amperes)",
        "Ensure Condensate pan is clean and drain runs free of obstruction",
        "Record Compressor Amperes",
        "Inspect Economizer for proper operation",
        "Inspect thermostat for proper operation"
      ],
      "Semi-Annual": [
        "Clean condensate pan and drain",
        "Tighten all electrical connections (Lock Out Tag Out)",
        "Check all fasteners and set screws (Lock Out Tag Out)",
        "Clean Condenser Fan and Coil",
        "Clean Evaporator Fan and Coil"
      ]
    }
  },
  "Basement Liebert Units": {
    "amps": false,
    "intervals": {
      "Monthly": [
        "Blower: Impellers free of debris — USE LOTO",
        "Blower: Bearings are FREE",
        "Blower: Inspect belt condition and tension (replace if necessary) — USE LOTO",
        "Humidifier: Inspect drain pan for leaks",
        "Humidifier: Inspect Humidifier Lamps",
        "Humidifier: Inspect humidifier fill valve assembly — confirm proper operation",
        "Humidifier: Check pan for mineral deposits — clean if necessary",
        "Heaters: Inspect heating elements for deterioration",
        "Heaters: Engage heaters through the controller and confirm proper operation",
        "Air Filters: Check air filter switch",
        "Air Filters: Wipe section clean",
        "Condensate Pump: Inspect pump operation and connections",
        "CHW Piping: Inspect all actuators for leaks and unrestricted movement"
      ],
      "Semi-Annual": [
        "Blower: Clean and inspect blower wheel(s) for loose or cracked blades",
        "Blower: Bearings inspect for free movement and check set screw for tightness",
        "Blower: Lubricate drive motor if serviceable (2oz every 3 years from initial PM date)",
        "Blower: Inspect belt condition and tension (replace if necessary)",
        "Blower: Inspect and tighten electrical connections"
      ]
    }
  },
  "Bathroom Hardware": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Inspect all hinges — repair if necessary",
        "Inspect privacy latches for proper operation and alignment",
        "Inspect partition alignment — repair if necessary",
        "Inspect partition floor skirts — repair if necessary",
        "Inspect partition mounting hardware and anchoring — repair if necessary",
        "Inspect accessory coat hook and toilet paper dispenser — repair if necessary",
        "Inspect entrance door hardware and operation — repair if necessary",
        "Inspect Janitor closet lock and door hardware — repair if necessary"
      ]
    }
  },
  "Bathroom Plumbing": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Inspect and test all fixtures for proper mounting and operation — repair if necessary",
        "Inspect and test all soap dispensers for proper mounting and operation — repair if necessary",
        "Inspect and test all Flushometers for proper operation and no leakage — repair if necessary",
        "Inspect and ensure that all Escutcheons are properly installed — repair if necessary",
        "Inspect and ensure that all drains are working properly and not leaking — repair if necessary",
        "Inspect and ensure that toilet paper holders are not loose and working properly — repair if necessary"
      ]
    }
  },
  "Blowdown Penthouse": {
    "amps": false,
    "intervals": {
      "Semi-Annual": [
        "Primary Pump #1 — blow down",
        "Primary Pump #2 — blow down",
        "Primary Pump #3 — blow down",
        "Primary Pump #4 — blow down",
        "Secondary Pump #1 — blow down",
        "Secondary Pump #2 — blow down",
        "Secondary Pump #3 — blow down",
        "Secondary Pump #4 — blow down",
        "Chilled Pump #1 — blow down",
        "Chilled Pump #2 — blow down",
        "Chilled Pump #3 — blow down",
        "Chilled Pump #4 — blow down",
        "HX Plate and Frame — HX 1",
        "HX Plate and Frame — HX 2",
        "Brominator",
        "Strainer — blow down",
        "Tower Bleed",
        "Tower Filter",
        "Separator",
        "Bag Filter",
        "Tower Filtration #1",
        "Tower Filtration #2",
        "Ensure air vents are operating properly"
      ]
    }
  },
  "Domestic Hot Water System": {
    "amps": true,
    "ampLabels": [
      "Gas Heater Pump",
      "Elec HWH Element",
      "Fitness Pump"
    ],
    "intervals": {
      "Quarterly": [
        "Gas Fired Heater (Kitchen): Inspect tank for any signs of leakage",
        "Gas Fired Heater (Kitchen): Increase Temp Set Point to activate heater",
        "Gas Fired Heater (Kitchen): Inspect gas line for corrosion (repair if necessary)",
        "Gas Fired Heater (Kitchen): Inspect Flue for damage or signs of leakage",
        "Gas Fired Heater (Kitchen): Run heat — check flame pattern (refer to O+M)",
        "Gas Fired Heater (Kitchen): Blow down sediment from bottom of tank",
        "Gas Circulation Pump (Kitchen): Inspect Pump for any signs of leakage",
        "Gas Circulation Pump (Kitchen): Record amps and compare with Nameplate",
        "Electric HWH (Fitness): Inspect Tank for any signs of leakage",
        "Electric HWH (Fitness): Inspect Heating Elements and Wiring (use LOTO)",
        "Electric HWH (Fitness): Increase Temp set point to activate heater",
        "Electric HWH (Fitness): Record current draw on each heating element and compare with Nameplate",
        "Circulation Pump (Fitness): Inspect Pump for any signs of leakage",
        "Circulation Pump (Fitness): Record amps and compare with Nameplate"
      ]
    }
  },
  "Drain Fitness Center": {
    "amps": false,
    "intervals": {
      "Monthly": [
        "Remove hair from interceptors",
        "Flush drains with water",
        "Snake each drain using 100' snake"
      ],
      "Quarterly": [
        "Remove hair from interceptors",
        "Flush drains with water",
        "Snake each drain using 100' snake",
        "Apply WHAM to shower and sink drains — USE PROPER PPE",
        "Flush with water after treating as directed by manufacturer"
      ]
    }
  },
  "FCU": {
    "amps": true,
    "ampLabels": [
      "Motor 1",
      "Motor 2 (DD)",
      "Heater B1",
      "Heater B2"
    ],
    "intervals": {
      "Quarterly": [
        "Inspect physical conditions of sheaves and pulleys — check alignment",
        "Inspect all bearings, pulleys and set screws for tightness — adjust if necessary",
        "Inspect belt condition and tension — use belts checker",
        "Clean and vacuum condensate pan and drain",
        "Inspect condensate pump for proper operation",
        "Test flood alarm circuit — pump and pan sensors",
        "Ensure both CHW Actuators close when flood alarm is tripped",
        "Exercise all automatic and manual isolation valves",
        "Test proper operation of thermostats",
        "Test all gauges and ensure proper operation — replace if necessary",
        "Ensure proper operation of electric heaters in FCU-B1 and B2 — record amperes",
        "Inspect blower vibration eliminators — adjust if necessary",
        "Inspect all contactors for excessively burnt, corroded or pitted contacts",
        "Inspect all wires for signs of overheating — replace any wires if necessary",
        "Inspect physical condition and proper operation of Chilled Water Actuator",
        "Inspect all chilled water piping — repair or add insulation where necessary",
        "Measure motor(s) amperage and record (DD drives have 2 motors)"
      ],
      "Semi-Annual": [
        "Blow down chilled water strainer",
        "Change Air Filter in the Unit — see master sheet for proper size"
      ],
      "Annual": [
        "Lubricate shaft bearings (if serviceable type)",
        "Lubricate motor (if serviceable type)"
      ]
    }
  },
  "Fan Exhaust": {
    "amps": false,
    "intervals": {
      "Semi-Annual": [
        "Check belt condition, replace or adjust tension as necessary",
        "Clean the fan wheel and shaft",
        "Inspect all electrical terminations and tighten as necessary",
        "Lubricate fan shaft bearings (USE SHELL ALVANIA #2)",
        "Lubricate drive motor if applicable (USE CHEVRON SRI)"
      ]
    }
  },
  "Fan Exhaust Kitchen": {
    "amps": true,
    "ampLabels": [
      "L1",
      "L2",
      "L3"
    ],
    "intervals": {
      "Quarterly": [
        "Inspect belt for wear — adjust or replace as necessary",
        "Inspect physical condition and proper alignment of sheaves and pulleys",
        "Inspect all electrical terminations — tighten as necessary",
        "Inspect bearings and ensure set screws are snug",
        "Ensure access door to blower wheel are tight and there are no leaks",
        "Inspect vibration eliminators — adjust or replace as necessary",
        "Record Amperes (L1, L2, L3)",
        "Wipe down all internal and external parts of the unit",
        "Run and ensure proper operation of the unit after performing PM"
      ],
      "Semi-Annual": [
        "Lubricate fan shaft bearings — refer to Lube Master",
        "Lubricate drive motor (if applicable — refer to O+M)"
      ]
    }
  },
  "Fan Smoke Purge": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Inspect belts for wear (adjust or replace as necessary)",
        "Inspect sheaves and pulleys for wear and alignment",
        "Inspect exterior of fans for any signs of rust or corrosion and repair same",
        "Inspect spring isolators for signs of wear or failure",
        "Clean fan wheel and shaft",
        "Inspect all electrical terminations and tighten as necessary",
        "Ensure supply and return screens or louvers (as applicable) are free of debris and move freely",
        "After PMs are completed, see Chief Engineer to perform Quarterly run test"
      ],
      "Semi-Annual": [
        "Lubricate fan shaft bearings (USE SHELL ALVANIA #2)",
        "Lubricate drive motor if applicable (USE CHEVRON SRI)"
      ]
    }
  },
  "Filtration Make-Up": {
    "amps": true,
    "ampLabels": [
      "Motor Amps"
    ],
    "intervals": {
      "Quarterly": [
        "Inspect Fan for proper operation",
        "Ensure blades are free from debris and spin freely",
        "Record Motor Amperes",
        "Vacuum supply and return registers",
        "Replace Pre-Filters"
      ],
      "Semi-Annual": [
        "Replace 4 inch HEPA Filters"
      ],
      "Annual": [
        "Replace Charcoal activated filters"
      ]
    }
  },
  "Fountain Courtyard": {
    "amps": true,
    "ampLabels": [
      "SE",
      "CTR#1",
      "CTR#2",
      "SW"
    ],
    "intervals": {
      "Monthly": [
        "Inspect general condition of water",
        "Inspect the domestic water makeup system operation",
        "Remove and clean filter cartridge",
        "Record Motor Amperes (SE, CTR#1, CTR#2, SW)",
        "Ensure all spray heads are clear of debris",
        "Ensure PVC screening is clean",
        "Remove PVC screening and inspect pump filter screening — clean if necessary",
        "Check condition of the anode — replace if necessary (check O+M)"
      ],
      "Semi-Annual": [
        "Full fountain cleaning",
        "Shock with liquid chlorine 3 days before the PM"
      ]
    }
  },
  "Fountain Water Hall": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Inspect all water connections for signs of leakage",
        "Vacuum Condenser Coil",
        "Inspect Condenser Fan operation — clean if necessary",
        "Check Refrigerant Cycle (Evaporator Temp, Condenser Coil Temperature)",
        "Inspect for refrigerant leaks",
        "Inspect water actuator and linkages",
        "Ensure drain is clean and drain runs free of obstruction",
        "Tighten all electrical connections",
        "Check all fasteners and set screws"
      ]
    }
  },
  "GE Penthouse Unit": {
    "amps": true,
    "ampLabels": [
      "Evap Fan",
      "Cond Fan",
      "Crankcase Htr",
      "Compressor"
    ],
    "intervals": {
      "Quarterly": [
        "Clean all air filters",
        "Inspect Evaporator Fan operation — clean if necessary",
        "Record Evaporator Fan Amperes",
        "Inspect Condenser Fan operation — clean if necessary",
        "Record Condenser Fan Amperes",
        "Check Refrigerant Cycle (Evaporator Temp, Condenser Coil Temperature)",
        "Inspect for refrigerant leaks",
        "Check all contactors and controls",
        "Inspect Crankcase Heaters if Equipped (Record Amperes)",
        "Ensure Condensate pan is clean and drain runs free of obstruction",
        "Record Compressor Amperes",
        "Inspect thermostat for proper operation",
        "Clean Condenser Fan and Coil",
        "Clean Evaporator Fan and Coil"
      ],
      "Semi-Annual": [
        "Clean condensate pan and drain",
        "Tighten all electrical connections (Lock Out Tag Out)",
        "Check all fasteners and set screws (Lock Out Tag Out)"
      ]
    }
  },
  "HV and Fan Units": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Make sure to include EX-B1, AC-B1, SF-B2 in this PM",
        "Blower (Direct Drive): Check physical condition of blower section, wipe any dirt buildup from blades",
        "Blower: Check cone alignment, set screws and bearings for tightness",
        "Blower: Check Motor and motor mounting section for any damage — REPORT ANY ISSUES",
        "Blower: Ensure motor mounting bolts are snug",
        "Blower: Check motor shaft for free rotation (LOTO)"
      ]
    }
  },
  "Stairwell Heater": {
    "amps": true,
    "ampLabels": [
      "Blower",
      "Heating Element"
    ],
    "intervals": {
      "Quarterly": [
        "Vacuum Elements",
        "Clean blower wheel",
        "Record Amperage of blower",
        "Record amperage of heating element",
        "Replace Air Filters",
        "Confirm Stat Operation",
        "Ensure all electrical connections are tight",
        "Wipe down cabinet"
      ]
    }
  },
  "Hot Water Heater": {
    "amps": false,
    "intervals": {
      "Quarterly": [
        "Check for any signs of discharge of the Safety Valve into the pan",
        "Ensure the temperature is between 110°F and 120°F max",
        "Inspect all wiring",
        "Element Condition — Leakage? Corrosion?"
      ],
      "Semi-Annual": [
        "Remove and clean Low Water Cutoff sensor"
      ]
    }
  },
  "Liebert Basement": {
    "amps": false,
    "intervals": {
      "Monthly": [
        "Blower: Clean and inspect blower wheel(s) for loose or cracked blades",
        "Blower: Bearings inspect for free movement and check set screw for tightness",
        "Blower: Inspect belt condition and tension (replace if necessary) — USE LOTO",
        "Heaters: Inspect heating elements for deterioration",
        "Heaters: Engage heaters through the controller and confirm proper operation",
        "Air Filters: Check air filter switch",
        "Air Filters: Wipe section clean including intake grills — report any damage to unit",
        "Condensate Pump: Inspect mechanical pump operation",
        "Condensate Pump: Inspect all electrical connections",
        "CHW Piping: Inspect all piping actuators for leaks and unrestricted movement (stroke via Test Outputs Menu)",
        "CHW Piping: Inspect all CHW insulation — repair if necessary",
        "CHW Piping: Inspect and test supply, return gauges and iso valves — replace if necessary",
        "CHW Piping: Inspect and test all Belimo Actuators — report any issues to Chief immediately"
      ],
      "Semi-Annual": [
        "Blower: Lubricate drive motor if serviceable (2oz every 3 years from initial PM date)",
        "Blower: Inspect and tighten electrical connections",
        "Strainers: Blow down supply strainers",
        "Strainers: Ensure there are no leaks, reinstall cap and make sure there are no leaks"
      ]
    }
  }
};
