/**
 * Writes one audit row. Never pass passwords, tokens or personal data in `detail`.
 * IP addresses are not stored.
 */
export async function audit(db, { userId = null, action, entity = null, entityId = null, detail = null }) {
  await db.run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      userId,
      action,
      entity,
      entityId == null ? null : String(entityId),
      detail == null ? null : JSON.stringify(detail),
      Date.now(),
    ],
  );
}
