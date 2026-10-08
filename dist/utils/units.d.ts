/** How many `toUnit` one `fromUnit` is (e.g. g → Kilograms = 0.001). Null when the units can't be converted. */
export declare function unitConversionFactor(fromUnit: string, toUnit: string): number | null;
