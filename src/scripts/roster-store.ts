const prefix = 'star-rail-builds:';
export const rosterKeys = {
    owned: prefix + 'owned-characters',
    plans: prefix + 'character-plans',
    filter: prefix + 'relic-roster-filter',
    statMode: prefix + 'relic-stat-mode',
    hideNames: prefix + 'relic-hide-names',
    hideRanked: prefix + 'relic-hide-ranked',
};

export const rosterApp = 'star-rail-builds';

export type Plan = { sets: string[]; stats: Record<string, string[]> };
export type Plans = Record<string, Plan>;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stringList(value: unknown) {
    return Array.isArray(value)
        ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
        : [];
}

export function parseJson(value: string | null): unknown {
    if (value === null) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

const memory = new Map<string, string>();
export function readSetting(key: string) {
    try {
        return localStorage.getItem(key);
    } catch {
        return memory.get(key) ?? null;
    }
}

export function saveSetting(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        memory.set(key, value);
    }
}

export function readPlans(value: unknown): Plans {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, plan]) => {
        if (!isRecord(plan) || !Array.isArray(plan.sets) || !isRecord(plan.stats)) return [];
        const stats = Object.fromEntries(Object.entries(plan.stats).map(([key, ids]) =>
            [key, stringList(ids)],
        ));
        return [[id, { sets: stringList(plan.sets), stats }]];
    }));
}

export function readRoster(knownIds: Set<string>) {
    return {
        owned: new Set(stringList(parseJson(readSetting(rosterKeys.owned)))
            .filter((id) => knownIds.has(id))),
        plans: readPlans(parseJson(readSetting(rosterKeys.plans))),
    };
}

export function isRosterEvent(event: StorageEvent) {
    return event.key === null || event.key === rosterKeys.owned || event.key === rosterKeys.plans;
}
