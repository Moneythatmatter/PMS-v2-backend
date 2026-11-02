import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import {
  accSharedTables,
  accTables,
  getById,
  list,
  listShared,
  type Row,
} from "../../models/accounts/repo.js";
import { getRowById, listRows } from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import { ConflictError, ValidationError } from "../../errors/index.js";

/** Party types a Purchase & Stores supplier can be linked to. */
export const VENDOR_PARTY_TYPES = ["VEND"] as const;

/** Fields Purchase owns; everything else on a supplier comes from the party. */
const PS_OWNED_FIELDS = ["supplierCode", "paymentTerms", "rating", "status", "createdDate", "partyId"] as const;

const SUPPLIERS = psModel.tables.suppliers;
const SETUP_HINT = "Run backend/sql/ps-suppliers-party-link.sql in Supabase.";

async function assertSchema(): Promise<void> {
  const { error } = await supabase.from(SUPPLIERS).select("party_id").limit(1);
  if (error && /party_id/.test(error.message)) throw new ValidationError(`Vendors are not linked to Accounts yet. ${SETUP_HINT}`);
}

async function partyTypeCodes(): Promise<Map<string, string>> {
  const types = await listShared(accSharedTables.partyTypes);
  return new Map(types.map((t) => [t.id as string, t.typeCode as string]));
}

const isVendorType = (code: string | null | undefined) => (VENDOR_PARTY_TYPES as readonly string[]).includes(code ?? "");

/** Supplier columns copied from the party, so readers of ps_suppliers see Accounts data. */
function partySnapshot(p: Row): Row {
  return {
    supplierName: p.partyName,
    contactPerson: p.contactPersonName ?? "",
    email: p.email || p.contactPersonEmail || "",
    phone: p.phone || p.contactPersonPhone || "",
    gstin: p.gstin || null,
    panNumber: p.panNumber || null,
    address: [p.addressLine1, p.addressLine2].filter(Boolean).join(", ") || null,
    city: p.city || null,
  };
}

async function loadLinkableParty(partyId: unknown): Promise<Row> {
  if (!partyId || typeof partyId !== "string") throw new ValidationError("Select the Accounts party for this vendor");
  const party = await getById(accTables.parties, partyId);
  if (!party) throw new ValidationError("Selected Accounts party was not found");
  const typeCode = (await partyTypeCodes()).get(party.partyTypeId) ?? "";
  if (!isVendorType(typeCode)) throw new ValidationError("Only parties of type Vendor can be used as Purchase vendors");
  if (party.status !== "Active") throw new ValidationError(`Party '${party.partyName}' is ${party.status} in Accounts`);
  return party;
}

async function assertPartyFree(partyId: string, supplierId?: string): Promise<void> {
  const rows = await listRows<Row>(SUPPLIERS, { filters: { party_id: partyId } });
  const other = rows.find((r) => r.id !== supplierId);
  if (other) throw new ConflictError(`This party is already vendor ${other.supplierCode} (${other.supplierName})`);
}

function keepPsOwned(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (key !== "id" && !(PS_OWNED_FIELDS as readonly string[]).includes(key)) delete body[key];
  }
}

/** Create: the supplier must point to a Vendor party; identity fields are taken from it. */
export async function prepareSupplierCreate(body: Record<string, unknown>): Promise<void> {
  await assertSchema();
  keepPsOwned(body);
  const party = await loadLinkableParty(body.partyId);
  await assertPartyFree(party.id);
  body.supplierCode = String(body.supplierCode ?? "").trim().toUpperCase() || String(party.partyCode).toUpperCase();
  body.status = body.status ?? "Active";
  Object.assign(body, partySnapshot(party));
}

/** Update: only Purchase-owned fields change; party details are refreshed from Accounts. */
export async function prepareSupplierUpdate(id: string, body: Record<string, unknown>): Promise<void> {
  await assertSchema();
  keepPsOwned(body);
  delete body.id;
  const existing = await getRowById<Row>(SUPPLIERS, id);
  if (!existing) throw new ValidationError("Vendor not found");
  if (Object.keys(body).every((k) => k === "status")) return;
  const partyId = (body.partyId as string | undefined) ?? existing.partyId;
  if (!partyId) throw new ValidationError("Link this vendor to an Accounts party first");
  if (body.partyId && body.partyId !== existing.partyId) await assertPartyFree(String(body.partyId), id);
  const party = await loadLinkableParty(partyId);
  if (body.supplierCode !== undefined) body.supplierCode = String(body.supplierCode).trim().toUpperCase() || existing.supplierCode;
  Object.assign(body, partySnapshot(party));
}

/** Overlay live party data on supplier rows. */
export async function attachSupplierPartyData<T>(rows: T[]): Promise<T[]> {
  const items = rows as Row[];
  const ids = [...new Set(items.map((r) => r.partyId).filter(Boolean))] as string[];
  if (!ids.length) return items.map((r) => ({ ...r, partyId: r.partyId ?? null, linked: false })) as T[];
  const [parties, types] = await Promise.all([list(accTables.parties, { in: { id: ids } }), partyTypeCodes()]);
  const byId = new Map(parties.map((p) => [p.id as string, p]));
  return items.map((r) => {
    const p = r.partyId ? byId.get(r.partyId) : undefined;
    const typeCode = p ? types.get(p.partyTypeId) ?? null : null;
    if (!p || !isVendorType(typeCode)) return { ...r, partyId: r.partyId ?? null, linked: false };
    return {
      ...r,
      ...partySnapshot(p),
      gstin: p.gstin || undefined,
      panNumber: p.panNumber || undefined,
      address: [p.addressLine1, p.addressLine2].filter(Boolean).join(", ") || undefined,
      city: p.city || undefined,
      linked: true,
      partyCode: p.partyCode,
      partyStatus: p.status,
      creditDays: Number(p.creditDays ?? 0),
    };
  }) as T[];
}

/** Vendor parties, with the supplier already linked to each. */
export async function listSupplierPartyOptions(): Promise<Row[]> {
  await assertSchema();
  const [parties, types, suppliers] = await Promise.all([
    list(accTables.parties, { select: "id,party_code,party_name,party_type_id,gstin,city,status" }),
    partyTypeCodes(),
    listRows<Row>(SUPPLIERS),
  ]);
  const linked = new Map(suppliers.filter((s) => s.partyId).map((s) => [s.partyId as string, s]));
  return parties
    .filter((p) => isVendorType(types.get(p.partyTypeId)))
    .sort((a, b) => String(a.partyName).localeCompare(String(b.partyName)))
    .map((p) => {
      const s = linked.get(p.id);
      return {
        id: p.id,
        partyCode: p.partyCode,
        partyName: p.partyName,
        gstin: p.gstin,
        city: p.city,
        status: p.status,
        linkedSupplierId: s?.id ?? null,
        linkedSupplierCode: s?.supplierCode ?? null,
      };
    });
}

/** A party used as a Purchase vendor must stay Vendor. */
export async function assertSupplierPartyType(partyId: string, partyTypeId: unknown): Promise<void> {
  const typeCode = (await partyTypeCodes()).get(String(partyTypeId ?? "")) ?? "";
  if (isVendorType(typeCode)) return;
  const { data, error } = await supabase
    .from(SUPPLIERS)
    .select("supplier_code")
    .eq("property_id", getActivePropertyId() ?? "")
    .eq("party_id", partyId)
    .limit(1);
  if (error) return;
  if (data?.length) {
    throw new ConflictError(`This party is Purchase vendor ${data[0].supplier_code}; its type must stay Vendor`);
  }
}

/** Keep the Purchase copy in step after a party is edited in Accounts. */
export async function syncSuppliersFromParty(party: Row): Promise<void> {
  if (!party?.id || !getActivePropertyId()) return;
  const { error } = await supabase
    .from(SUPPLIERS)
    .update({
      supplier_name: party.partyName,
      contact_person: party.contactPersonName ?? "",
      email: party.email || party.contactPersonEmail || "",
      phone: party.phone || party.contactPersonPhone || "",
      gstin: party.gstin || null,
      pan_number: party.panNumber || null,
      address: [party.addressLine1, party.addressLine2].filter(Boolean).join(", ") || null,
      city: party.city || null,
    })
    .eq("property_id", getActivePropertyId()!)
    .eq("party_id", party.id);
  if (error && !/party_id/.test(error.message)) throw new Error(error.message);
}
