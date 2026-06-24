import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../config/providers.js";

const USAGE_URL = "https://copilot.tencent.com/v2/billing/meter/get-user-resource";

function parseResetTime(value) {
  if (!value) return null;
  try {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString();
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const timestamp = Number(value);
      return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
    }
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

function refillCadence(account) {
  const start = parseResetTime(account.CycleStartTime);
  const end = parseResetTime(account.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  const token = accessToken || apiKey;
  if (!token) return { message: "CodeBuddy CN credential not available." };

  try {
    const response = await proxyAwareFetch(USAGE_URL, {
      method: "POST",
      headers: {
        ...(PROVIDERS["codebuddy-cn"]?.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy CN credential invalid or expired." };
    }
    if (!response.ok) return { message: `CodeBuddy CN quota API error (${response.status}).` };

    const json = await response.json();
    if (json?.code !== 0) return { message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}` };

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) return { message: "CodeBuddy CN connected. No credit package found." };

    const cycleEndMs = (account) => {
      const reset = parseResetTime(account.CycleEndTime);
      return reset ? new Date(reset).getTime() : Number.POSITIVE_INFINITY;
    };
    const refillGapMs = 2 * 24 * 60 * 60 * 1000;
    const isRefill = (account) => {
      const cycleEnd = cycleEndMs(account);
      const deductionEnd = Number(account.DeductionEndTime);
      return Number.isFinite(cycleEnd) && Number.isFinite(deductionEnd) && deductionEnd - cycleEnd > refillGapMs;
    };
    const byExpiry = (a, b) => cycleEndMs(a) - cycleEndMs(b);

    const refills = accounts.filter(isRefill).sort(byExpiry);
    const bonuses = accounts.filter((account) => !isRefill(account)).sort(byExpiry);
    const quotas = {};
    const seenRefill = {};

    refills.forEach((account) => {
      const base = refillCadence(account);
      seenRefill[base] = (seenRefill[base] || 0) + 1;
      const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
      quotas[name] = {
        used: num(account.CycleCapacityUsedPrecise, account.CycleCapacityUsed),
        total: num(account.CycleCapacitySizePrecise, account.CycleCapacitySize),
        resetAt: parseResetTime(account.CycleEndTime),
        unlimited: false,
      };
    });

    bonuses.forEach((account, index) => {
      quotas[`Bonus Pack ${index + 1}`] = {
        used: num(account.CapacityUsedPrecise, account.CapacityUsed),
        total: num(account.CapacitySizePrecise, account.CapacitySize),
        resetAt: parseResetTime(account.CycleEndTime),
        unlimited: false,
      };
    });

    const basePackage = refills[0] || accounts[0] || {};
    return { plan: basePackage.PackageName || basePackage.SubProductName || "CodeBuddy CN", quotas };
  } catch (error) {
    return { message: `CodeBuddy CN error: ${error.message}` };
  }
}