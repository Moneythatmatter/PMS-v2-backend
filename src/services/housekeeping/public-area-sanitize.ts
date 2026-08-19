export function sanitizePublicAreaInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  if (body.code != null && body.areaCode == null) {
    body.areaCode = body.code;
  }
  if (body.category != null && body.areaType == null) {
    body.areaType = body.category;
  }
  if (body.floor != null && body.floorNumber == null) {
    const n = parseInt(String(body.floor).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n)) body.floorNumber = n;
  }

  delete body.code;
  delete body.category;
  delete body.floor;
  delete body.assignedStaff;
  delete body.supervisor;
  delete body.status;
  delete body.checklist;
  delete body.history;
  delete body.updatedAt;
  delete body.createdAt;

  return body;
}
