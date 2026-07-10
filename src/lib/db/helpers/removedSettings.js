export const REMOVED_SETTING_KEYS = Object.freeze([
  "ammail_base_url",
  "ammail_api_key",
  "ammail_default_domain",
  "ammail_webhook_secret",
  "ammail_cf_account_id",
  "ammail_cf_api_token",
  "ammail_cf_domain",
  "ammail_cf_workers_dev_url",
  "twocaptcha_api_key",
  "cf_automation_proxy_pool",
  "cf_automation_browser_headless",
  "cf_automation_concurrency",
]);

export function omitRemovedSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  const cleaned = { ...settings };
  for (const key of REMOVED_SETTING_KEYS) delete cleaned[key];
  return cleaned;
}