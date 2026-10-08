/** Size of each unit in its dimension's base unit (g, ml, piece). */
const UNIT_ALIASES = {
    mg: { dimension: "mass", base: 0.001 },
    milligram: { dimension: "mass", base: 0.001 },
    milligrams: { dimension: "mass", base: 0.001 },
    g: { dimension: "mass", base: 1 },
    gm: { dimension: "mass", base: 1 },
    gms: { dimension: "mass", base: 1 },
    gram: { dimension: "mass", base: 1 },
    grams: { dimension: "mass", base: 1 },
    kg: { dimension: "mass", base: 1000 },
    kgs: { dimension: "mass", base: 1000 },
    kilo: { dimension: "mass", base: 1000 },
    kilogram: { dimension: "mass", base: 1000 },
    kilograms: { dimension: "mass", base: 1000 },
    ml: { dimension: "volume", base: 1 },
    millilitre: { dimension: "volume", base: 1 },
    millilitres: { dimension: "volume", base: 1 },
    milliliter: { dimension: "volume", base: 1 },
    milliliters: { dimension: "volume", base: 1 },
    l: { dimension: "volume", base: 1000 },
    lt: { dimension: "volume", base: 1000 },
    ltr: { dimension: "volume", base: 1000 },
    ltrs: { dimension: "volume", base: 1000 },
    litre: { dimension: "volume", base: 1000 },
    litres: { dimension: "volume", base: 1000 },
    liter: { dimension: "volume", base: 1000 },
    liters: { dimension: "volume", base: 1000 },
    pc: { dimension: "count", base: 1 },
    pcs: { dimension: "count", base: 1 },
    piece: { dimension: "count", base: 1 },
    pieces: { dimension: "count", base: 1 },
    no: { dimension: "count", base: 1 },
    nos: { dimension: "count", base: 1 },
    unit: { dimension: "count", base: 1 },
    units: { dimension: "count", base: 1 },
    each: { dimension: "count", base: 1 },
    dozen: { dimension: "count", base: 12 },
    dz: { dimension: "count", base: 12 },
};
const normalize = (unit) => unit.trim().toLowerCase().replace(/\.$/, "");
/** How many `toUnit` one `fromUnit` is (e.g. g → Kilograms = 0.001). Null when the units can't be converted. */
export function unitConversionFactor(fromUnit, toUnit) {
    const from = normalize(fromUnit);
    const to = normalize(toUnit);
    if (!from || !to)
        return null;
    if (from === to)
        return 1;
    const a = UNIT_ALIASES[from];
    const b = UNIT_ALIASES[to];
    if (!a || !b || a.dimension !== b.dimension)
        return null;
    return a.base / b.base;
}
//# sourceMappingURL=units.js.map