import * as admin from 'firebase-admin';

export interface DepositTier {
  upTo: number | null;  // max subtotal for this tier. null = "and above" (catch-all)
  percent: number;
}

export interface ManufacturerConfigData {
  name: string;
  sku?: string | null;
  signNowTemplateId: string;
  depositPercent?: number | null;
  depositTiers?: DepositTier[];
  active: boolean;
}

// In-memory cache to avoid repeated Firestore reads within a single function instance
let configCache: Map<string, ManufacturerConfigData> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getManufacturerConfigs(): Promise<Map<string, ManufacturerConfigData>> {
  const now = Date.now();
  if (configCache && (now - cacheTimestamp) < CACHE_TTL) {
    return configCache;
  }

  const db = admin.firestore();
  const snapshot = await db.collection('manufacturer_config').where('active', '==', true).get();
  const configs = new Map<string, ManufacturerConfigData>();
  snapshot.forEach((doc) => {
    const data = doc.data() as ManufacturerConfigData;
    configs.set(data.name, data);
  });

  configCache = configs;
  cacheTimestamp = now;
  return configs;
}

export async function getTemplateId(manufacturer: string): Promise<string | null> {
  const configs = await getManufacturerConfigs();
  // Try exact match first, then partial match (e.g. "American West Coast" → "American Carports")
  const config = configs.get(manufacturer);
  if (config?.signNowTemplateId) return config.signNowTemplateId;

  // Partial match: check if any config name is contained in the manufacturer name or vice versa
  for (const [name, cfg] of configs) {
    if (cfg.signNowTemplateId && (manufacturer.includes(name) || name.includes(manufacturer))) {
      return cfg.signNowTemplateId;
    }
  }

  return null;
}

// Resolve deposit percent from tiers or flat rate
function resolvePercent(config: ManufacturerConfigData, subtotal: number): number | null {
  if (config.depositTiers && config.depositTiers.length > 0) {
    const sorted = [...config.depositTiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    for (const tier of sorted) {
      if (tier.upTo == null || subtotal <= tier.upTo) {
        return tier.percent;
      }
    }
    return null;
  }
  return config.depositPercent ?? null;
}

// Find config by exact or partial manufacturer name match
function findConfig(configs: Map<string, ManufacturerConfigData>, manufacturer: string): ManufacturerConfigData | null {
  const exact = configs.get(manufacturer);
  if (exact) return exact;
  for (const [name, cfg] of configs) {
    if (manufacturer.includes(name) || name.includes(manufacturer)) {
      return cfg;
    }
  }
  return null;
}

export async function getDepositPercent(manufacturer: string, subtotal: number): Promise<number | null> {
  const configs = await getManufacturerConfigs();
  const config = findConfig(configs, manufacturer);
  if (!config) return null;
  return resolvePercent(config, subtotal);
}

export interface DepositConfigExport {
  percent?: number | null;
  tiers?: DepositTier[];
}

export async function getDepositConfigs(): Promise<Record<string, DepositConfigExport>> {
  const configs = await getManufacturerConfigs();
  const result: Record<string, DepositConfigExport> = {};
  configs.forEach((config, name) => {
    if (config.depositPercent != null || (config.depositTiers && config.depositTiers.length > 0)) {
      result[name] = {
        percent: config.depositPercent ?? null,
        tiers: config.depositTiers,
      };
    }
  });
  return result;
}

export async function getSkuForManufacturer(manufacturer: string): Promise<string | null> {
  const configs = await getManufacturerConfigs();
  const config = findConfig(configs, manufacturer);
  return config?.sku || null;
}

export function clearConfigCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}
