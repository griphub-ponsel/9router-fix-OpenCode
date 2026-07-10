import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { omitRemovedSettings } from "../helpers/removedSettings.js";

export default {
  version: 2,
  name: "remove-automation-settings",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;

    const current = parseJson(row.data, {});
    const cleaned = omitRemovedSettings(current);
    if (Object.keys(cleaned).length === Object.keys(current).length) return;

    db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(cleaned)]);
  },
};