const COPILOT_GROUP_NAME = "9Router";

export const buildCopilotAuthorizationHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
});

export const applyCopilotByokUtilitySettings = (settings, enabled) => {
  const next = { ...(settings || {}) };
  delete next["chat.utilityModel"];
  delete next["chat.utilitySmallModel"];

  if (enabled) next["chat.byokUtilityModelDefault"] = "mainAgent";
  else delete next["chat.byokUtilityModelDefault"];

  return next;
};

export const buildCopilotManualUtilitySettings = (enabled) => (
  enabled ? { "chat.byokUtilityModelDefault": "mainAgent" } : {}
);

export const getCopilotGroupName = () => COPILOT_GROUP_NAME;
