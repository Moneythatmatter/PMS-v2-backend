# Human Resources Module — Database Setup

Run these SQL files **in order** in the Supabase SQL Editor:

1. `auth-users-schema.sql`
2. `multi-property-schema.sql`
3. `multi-property-seeds.sql`
4. **`human-resources-schema.sql`** — creates all `hr_*` tables with UUID text PKs
5. **`human-resources-rls-patch.sql`** — **required** if API returns empty lists (RLS blocks anon key)
6. **`human-resources-seeds.sql`** — seeds Grand Palace Resort (`prop-grand-palace`)
7. **`human-resources-seeds-shaw-hotel.sql`** — seeds Shaw Hotel (`prop-shaw-hotel`) if that is your active property

**Already seeded?** Run **`human-resources-seeds-recent-joiners-patch.sql`** to update join dates to the past week and insert attendance records.

## Property scoping (empty Employee List?)

HR data is filtered by **active property**. If Supabase has rows but the UI shows none:

1. **Run `human-resources-rls-patch.sql`** in Supabase SQL Editor (most common fix — Table Editor shows data as `postgres`, but API uses anon key and gets 0 rows without this patch).
2. Seed the matching property:
   - **Shaw Hotel** → `human-resources-seeds-shaw-hotel.sql`
   - **Grand Palace Resort** → `human-resources-seeds.sql`
3. Or switch property from the header property picker.

## API

Mount: `GET/POST /api/human-resources/*`

Requires:
- `Authorization: Bearer <token>`
- `X-Property-Id: prop-grand-palace` (or your active property)

## Key tables

| Table | Purpose |
|-------|---------|
| `hr_departments` | Department master |
| `hr_employees` | Employee records |
| `hr_payroll_records` | Monthly payroll per employee |
| `hr_salary_payments` | Payment disbursements |
| `hr_leave_applications` | Leave requests |
| `hr_attendance_records` | Daily attendance |

All operational tables include `property_id` for multi-property scoping.

## Payroll workflow

1. `POST /api/human-resources/payroll/records/:id/approve`
2. `POST /api/human-resources/payroll/records/:id/payments` — creates `hr_salary_payments` row
