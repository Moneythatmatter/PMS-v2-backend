import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { attachRequestContext } from "../middleware/request-context.js";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { smTables } from "../models/sales-marketing/index.js";
import { ensureSmCodes } from "../utils/sales-marketing-codes.js";
import { getDashboard } from "../controllers/sales-marketing/dashboard.js";
import {
  ensureSystemBookingTypes,
  listBookingTypes,
} from "../controllers/sales-marketing/booking-types.js";

const router = Router();

router.use(requireAuth);
router.use(requireProperty);
router.use(attachRequestContext);

router.get("/dashboard", getDashboard);

router.get("/masters/booking-types", listBookingTypes);
router.post("/masters/booking-types/ensure-system", ensureSystemBookingTypes);

type SmCrudRoute = {
  path: string;
  table: string;
  prefix: string;
  orderBy?: string;
  codeFields?: { key: string; prefix: string }[];
};

const crudRoutes: SmCrudRoute[] = [
  {
    path: "/masters/venues-spaces",
    table: smTables.venues,
    prefix: "SMV",
    orderBy: "venue_code",
    codeFields: [{ key: "venueCode", prefix: "VEN" }],
  },
  {
    path: "/masters/lead-sources",
    table: smTables.leadSources,
    prefix: "SMS",
    orderBy: "source_name",
    codeFields: [{ key: "sourceCode", prefix: "LS" }],
  },
  {
    path: "/masters/activity-types",
    table: smTables.activityTypes,
    prefix: "SMA",
    orderBy: "type_name",
    codeFields: [{ key: "activityTypeCode", prefix: "AT" }],
  },
  {
    path: "/masters/deal-stages",
    table: smTables.dealStages,
    prefix: "SMD",
    orderBy: "sequence",
    codeFields: [{ key: "stageCode", prefix: "STG" }],
  },
  {
    path: "/masters/contact-types",
    table: smTables.contactTypes,
    prefix: "SMC",
    orderBy: "contact_type_name",
    codeFields: [{ key: "contactTypeCode", prefix: "CT" }],
  },
  { path: "/masters/booking-types", table: smTables.bookingTypes, prefix: "SMBT", orderBy: "sort_order" },
  {
    path: "/contacts",
    table: smTables.contacts,
    prefix: "SMCT",
    orderBy: "contact_name",
    codeFields: [{ key: "contactCode", prefix: "SMCT" }],
  },
  {
    path: "/leads",
    table: smTables.leads,
    prefix: "SML",
    orderBy: "created_at",
    codeFields: [{ key: "leadCode", prefix: "SML" }],
  },
  {
    path: "/deals",
    table: smTables.deals,
    prefix: "SMDL",
    orderBy: "created_at",
    codeFields: [{ key: "dealCode", prefix: "SMDL" }],
  },
  {
    path: "/activities",
    table: smTables.activities,
    prefix: "SMAC",
    orderBy: "activity_date",
    codeFields: [{ key: "activityCode", prefix: "SMAC" }],
  },
  {
    path: "/bookings",
    table: smTables.bookings,
    prefix: "SMBK",
    orderBy: "created_at",
    codeFields: [{ key: "bookingCode", prefix: "SMBK" }],
  },
  {
    path: "/promotions",
    table: smTables.promotions,
    prefix: "SMPR",
    orderBy: "created_at",
    codeFields: [{ key: "promoSchemeCode", prefix: "PRM" }],
  },
  {
    path: "/campaigns",
    table: smTables.campaigns,
    prefix: "SMCP",
    orderBy: "created_at",
    codeFields: [{ key: "campaignCode", prefix: "CMP" }],
  },
  {
    path: "/ota-channels",
    table: smTables.otaChannels,
    prefix: "SMOTA",
    orderBy: "channel_name",
    codeFields: [{ key: "channelCode", prefix: "OTA" }],
  },
];

for (const cfg of crudRoutes) {
  if (cfg.path === "/masters/booking-types") continue;
  const codeFields = cfg.codeFields;
  mountCrud(
    router,
    cfg.path,
    createTableCrud({
      table: cfg.table,
      idPrefix: cfg.prefix,
      orderBy: cfg.orderBy,
      mapIncoming: codeFields
        ? (body, ctx) => (ctx?.isCreate ? ensureSmCodes(body, codeFields) : body)
        : undefined,
    }),
  );
}

const bookingTypeCrud = createTableCrud({
  table: smTables.bookingTypes,
  idPrefix: "SMBT",
  orderBy: "sort_order",
});

router.get("/masters/booking-types/:id", bookingTypeCrud.get);
router.post("/masters/booking-types", bookingTypeCrud.create);
router.put("/masters/booking-types/:id", bookingTypeCrud.update);
router.patch("/masters/booking-types/:id", bookingTypeCrud.update);
router.delete("/masters/booking-types/:id", bookingTypeCrud.remove);

export default router;
