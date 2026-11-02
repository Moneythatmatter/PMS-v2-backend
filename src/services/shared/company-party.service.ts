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
import { foModel } from "../../models/front-office/index.js";
import { ConflictError, ValidationError } from "../../errors/index.js";

/** Party types a Front Office company can be linked to. */
export const COMPANY_PARTY_TYPES = ["CORP"] as const;

const FO_TYPES_BY_PARTY_TYPE: Record<string, string[]> = {
  CORP: ["Corporate", "Government", "Event"],
};

/** Fields Front Office owns; everything else on a company comes from the party. */
const FO_OWNED_FIELDS = ["code", "type", "corporateDiscount", "status", "partyId"] as const;

const SETUP_HINT = "Run backend/sql/fo-companies-party-link.sql in Supabase.";

async function assertSchema(): Promise<void> {
  const { error } = await supabase.from(foModel.tables.companies).select("party_id").limit(1);
  if (error && /party_id/.test(error.message)) throw new ValidationError(`Companies are not linked to Accounts yet. ${SETUP_HINT}`);
}

async function partyTypeCodes(): Promise<Map<string, string>> {
  const types = await listShared(accSharedTables.partyTypes);
  return new Map(types.map((t) => [t.id as string, t.typeCode as string]));
}

/** Company columns copied from the party, so readers of the companies table see Accounts data. */
function partySnapshot(p: Row): Row {
  return {
    name: p.partyName,
    contactPerson: p.contactPersonName ?? "",
    email: p.email ?? "",
    phone: p.phone || p.contactPersonPhone || "",
    gstNumber: p.gstin || null,
    address: [p.addressLine1, p.addressLine2].filter(Boolean).join(", "),
    city: p.city ?? "",
    creditLimit: Number(p.creditLimit ?? 0),
  };
}

async function loadLinkableParty(partyId: unknown): Promise<{ party: Row; typeCode: string }> {
  if (!partyId || typeof partyId !== "string") throw new ValidationError("Select the Accounts party for this company");
  const party = await getById(accTables.parties, partyId);
  if (!party) throw new ValidationError("Selected Accounts party was not found");
  const typeCode = (await partyTypeCodes()).get(party.partyTypeId) ?? "";
  if (!(COMPANY_PARTY_TYPES as readonly string[]).includes(typeCode)) {
    throw new ValidationError("Only parties of type Corporate can be used as Front Office companies");
  }
  if (party.status !== "Active") throw new ValidationError(`Party '${party.partyName}' is ${party.status} in Accounts`);
  return { party, typeCode };
}

async function assertPartyFree(partyId: string, companyId?: string): Promise<void> {
  const rows = await foModel.list<Row>(foModel.tables.companies, { filters: { party_id: partyId } });
  const other = rows.find((r) => r.id !== companyId);
  if (other) throw new ConflictError(`This party is already Front Office company ${other.code} (${other.name})`);
}

function resolveFoType(requested: unknown, typeCode: string): string {
  const allowed = FO_TYPES_BY_PARTY_TYPE[typeCode] ?? [];
  if (requested === undefined || requested === null || requested === "") return allowed[0];
  if (!allowed.includes(String(requested))) {
    throw new ValidationError(`A ${typeCode} party can only be booked as: ${allowed.join(", ")}`);
  }
  return String(requested);
}

function keepFoOwned(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!(FO_OWNED_FIELDS as readonly string[]).includes(key)) delete body[key];
  }
}

/** Create: the company must point to an Accounts party; identity fields are taken from it. */
export async function prepareCompanyCreate(body: Record<string, unknown>): Promise<void> {
  await assertSchema();
  keepFoOwned(body);
  const { party, typeCode } = await loadLinkableParty(body.partyId);
  await assertPartyFree(party.id);
  body.type = resolveFoType(body.type, typeCode);
  body.code = String(body.code ?? "").trim().toUpperCase() || String(party.partyCode).toUpperCase();
  body.corporateDiscount = Math.max(0, Number(body.corporateDiscount ?? 0) || 0);
  body.status = body.status ?? "Active";
  Object.assign(body, partySnapshot(party));
}

/** Update: only FO-owned fields change; party details are refreshed from Accounts. */
export async function prepareCompanyUpdate(id: string, body: Record<string, unknown>): Promise<void> {
  await assertSchema();
  keepFoOwned(body);
  const existing = await foModel.get<Row>(foModel.tables.companies, id);
  if (!existing) throw new ValidationError("Company not found");
  if (Object.keys(body).every((k) => k === "status")) return;
  const partyId = (body.partyId as string | undefined) ?? existing.partyId;
  if (!partyId) throw new ValidationError("Link this company to an Accounts party first");
  if (body.partyId && body.partyId !== existing.partyId) await assertPartyFree(String(body.partyId), id);
  const { party, typeCode } = await loadLinkableParty(partyId);
  const keptType = FO_TYPES_BY_PARTY_TYPE[typeCode]?.includes(existing.type) ? existing.type : undefined;
  body.type = resolveFoType(body.type ?? keptType, typeCode);
  if (body.code !== undefined) body.code = String(body.code).trim().toUpperCase() || existing.code;
  if (body.corporateDiscount !== undefined) body.corporateDiscount = Math.max(0, Number(body.corporateDiscount) || 0);
  Object.assign(body, partySnapshot(party));
}

/** Overlay live party data on company rows. */
export async function attachPartyData<T>(rows: T[]): Promise<T[]> {
  const items = rows as Row[];
  const ids = [...new Set(items.map((r) => r.partyId).filter(Boolean))] as string[];
  if (!ids.length) return items.map((r) => ({ ...r, partyId: r.partyId ?? null, linked: false })) as T[];
  const [parties, types] = await Promise.all([
    list(accTables.parties, { in: { id: ids } }),
    partyTypeCodes(),
  ]);
  const byId = new Map(parties.map((p) => [p.id as string, p]));
  return items.map((r) => {
    const p = r.partyId ? byId.get(r.partyId) : undefined;
    const typeCode = p ? types.get(p.partyTypeId) ?? null : null;
    if (!p || !(COMPANY_PARTY_TYPES as readonly string[]).includes(typeCode ?? "")) {
      return { ...r, partyId: r.partyId ?? null, linked: false };
    }
    return {
      ...r,
      ...partySnapshot(p),
      linked: true,
      partyCode: p.partyCode,
      partyStatus: p.status,
      partyTypeCode: typeCode,
      creditDays: Number(p.creditDays ?? 0),
    };
  }) as T[];
}

/** Corporate parties, with the FO company already linked to each. */
export async function listCompanyPartyOptions(): Promise<Row[]> {
  await assertSchema();
  const [parties, types, companies] = await Promise.all([
    list(accTables.parties, { select: "id,party_code,party_name,party_type_id,gstin,city,status" }),
    partyTypeCodes(),
    foModel.list<Row>(foModel.tables.companies),
  ]);
  const linked = new Map(companies.filter((c) => c.partyId).map((c) => [c.partyId as string, c]));
  return parties
    .map((p): Row => ({ ...p, partyTypeCode: types.get(p.partyTypeId) ?? null }))
    .filter((p) => (COMPANY_PARTY_TYPES as readonly string[]).includes(p.partyTypeCode ?? ""))
    .sort((a, b) => String(a.partyName).localeCompare(String(b.partyName)))
    .map((p) => {
      const c = linked.get(p.id);
      return {
        id: p.id,
        partyCode: p.partyCode,
        partyName: p.partyName,
        partyTypeCode: p.partyTypeCode,
        gstin: p.gstin,
        city: p.city,
        status: p.status,
        linkedCompanyId: c?.id ?? null,
        linkedCompanyCode: c?.code ?? null,
      };
    });
}

/** A party used as a Front Office company must stay Corporate. */
export async function assertCompanyPartyType(partyId: string, partyTypeId: unknown): Promise<void> {
  const typeCode = (await partyTypeCodes()).get(String(partyTypeId ?? "")) ?? "";
  if ((COMPANY_PARTY_TYPES as readonly string[]).includes(typeCode)) return;
  const { data, error } = await supabase
    .from(foModel.tables.companies)
    .select("code")
    .eq("property_id", getActivePropertyId() ?? "")
    .eq("party_id", partyId)
    .limit(1);
  if (error) return;
  if (data?.length) {
    throw new ConflictError(
      `This party is Front Office company ${data[0].code}; its type must stay Corporate`,
    );
  }
}

export type BillableCompany = { companyId: string; companyName: string; partyId: string; partyName: string };

/** A Front Office company that can be billed: linked to an active Corporate party. */
export async function loadBillableCompany(companyId: unknown): Promise<BillableCompany> {
  const id = String(companyId ?? "").trim();
  if (!id) throw new ValidationError("Select the company");
  const company = await foModel.get<Row>(foModel.tables.companies, id);
  if (!company) throw new ValidationError("Selected company was not found");
  if (company.status && company.status !== "Active") throw new ValidationError(`Company '${company.name}' is ${company.status}`);
  if (!company.partyId) throw new ValidationError(`Company '${company.name}' is not linked to an Accounts party`);
  const { party } = await loadLinkableParty(company.partyId);
  return { companyId: id, companyName: String(party.partyName), partyId: String(party.id), partyName: String(party.partyName) };
}

let reservationCompanyColumn = false;

async function hasReservationCompanyColumn(): Promise<boolean> {
  if (reservationCompanyColumn) return true;
  const { error } = await supabase.from(foModel.tables.reservations).select("company_id").limit(1);
  reservationCompanyColumn = !error;
  return reservationCompanyColumn;
}

/** Reservation create / update: a company is stored by id; its name comes from the company. */
export async function applyReservationCompany(body: Record<string, unknown>): Promise<void> {
  if (!("companyId" in body)) return;
  const id = String(body.companyId ?? "").trim();
  if (!(await hasReservationCompanyColumn())) {
    if (id) throw new ValidationError("Run backend/sql/accounts-fo-posting-phase2.sql in Supabase to link reservations to companies.");
    delete body.companyId;
    return;
  }
  if (!id) {
    body.companyId = null;
    return;
  }
  const company = await loadBillableCompany(id);
  body.companyId = company.companyId;
  body.companyName = company.companyName;
}

let groupCompanyColumn = false;

async function hasGroupCompanyColumn(): Promise<boolean> {
  if (groupCompanyColumn) return true;
  const { error } = await supabase.from(foModel.tables.foGroups).select("company_id").limit(1);
  groupCompanyColumn = !error;
  return groupCompanyColumn;
}

/**
 * Group create / update: resolve `companyId` to a company. Returns undefined when not given
 * (or the column is missing), null to clear. Billing checks the Accounts party link later.
 */
export async function resolveGroupCompany(
  companyIdInput: unknown,
): Promise<{ companyId: string; companyName: string } | null | undefined> {
  if (companyIdInput === undefined) return undefined;
  const id = String(companyIdInput ?? "").trim();
  if (!(await hasGroupCompanyColumn())) return undefined;
  if (!id) return null;
  const company = await foModel.get<Row>(foModel.tables.companies, id);
  if (!company) throw new ValidationError("Selected company was not found");
  return { companyId: id, companyName: String(company.name ?? "") };
}

/** Keep the FO copy in step after a party is edited in Accounts. */
export async function syncCompaniesFromParty(party: Row): Promise<void> {
  if (!party?.id || !getActivePropertyId()) return;
  const { error } = await supabase
    .from(foModel.tables.companies)
    .update({
      name: party.partyName,
      contact_person: party.contactPersonName ?? "",
      email: party.email ?? "",
      phone: party.phone || party.contactPersonPhone || "",
      gst_number: party.gstin || null,
      address: [party.addressLine1, party.addressLine2].filter(Boolean).join(", "),
      city: party.city ?? "",
      credit_limit: Number(party.creditLimit ?? 0),
    })
    .eq("property_id", getActivePropertyId()!)
    .eq("party_id", party.id);
  if (error && !/party_id/.test(error.message)) throw new Error(error.message);
}
