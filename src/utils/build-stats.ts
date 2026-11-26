import { loadJSON } from './content';
import { t, type getLocale } from './i18n';

// Variable relic main stats by slot. Head and Hands have fixed main stats.
// https://www.hoyolab.com/article/18957632
export const selectableMainStats = {
    body: ['hp%', 'atk%', 'def%', 'cr', 'cd', 'ogh', 'ehr'],
    feet: ['hp%', 'atk%', 'def%', 'spd'],
    planar_sphere: [
        'hp%', 'atk%', 'def%', 'physical-dmg', 'fire-dmg', 'ice-dmg',
        'lightning-dmg', 'wind-dmg', 'quantum-dmg', 'imaginary-dmg',
    ],
    link_rope: ['hp%', 'atk%', 'def%', 'be', 'err'],
} satisfies Record<string, string[]>;

const mainStatSlots = [
    { key: 'body', label: 'Body', family: 'cavern' },
    { key: 'feet', label: 'Feet', family: 'cavern' },
    { key: 'planar_sphere', label: 'Planar Sphere', family: 'planar' },
    { key: 'link_rope', label: 'Link Rope', family: 'planar' },
] as const;

type Locale = ReturnType<typeof getLocale>;
type SlotKey = keyof typeof selectableMainStats;
type StatEntry = string | { name?: string } | null;
export type RankedStat = { id: string; label: string; rank: number };

export function statName(locale: Locale, item: StatEntry) {
    const id = typeof item === 'string' ? item : item?.name;
    return id ? t(locale, 'stat', id, undefined, false) : '';
}

const substatIds = [
    'hp', 'atk', 'def', 'hp%', 'atk%', 'def%', 'spd', 'cr', 'cd', 'ehr', 'effect-res', 'be',
] as const;

// Flat HP/ATK/DEF substats are stored as hp/atk/def in builds, so their labels need the flat- prefix.
const flatSubstats = new Set(['hp', 'atk', 'def']);
const substatAliases: Record<string, string[]> = {
    'flat-hp': ['hp'], 'flat-atk': ['atk'], 'flat-def': ['def'],
    'break-effect': ['be'], 'cr/cd': ['cr', 'cd'],
};

function substatLabel(locale: Locale, id: string) {
    return statName(locale, flatSubstats.has(id) ? 'flat-' + id : id);
}

export function getSubstatOptions(locale: Locale) {
    return substatIds.map((id) => ({ id: id as string, label: substatLabel(locale, id) }));
}

export function getAllBuildSubstats(locale: Locale, buildPaths: string[]): RankedStat[] {
    const best = new Map<string, number>();
    for (const buildPath of buildPaths) {
        const priority: unknown[] = loadJSON(buildPath, 'relic-substats.json')?.substats_priority ?? [];
        priority.forEach((entry: any, index) => {
            const items: StatEntry[] = Array.isArray(entry?.items) ? entry.items : [entry];
            for (const item of items) {
                const raw = typeof item === 'string' ? item : item?.name;
                if (!raw) continue;
                for (const id of substatAliases[raw] ?? [raw]) {
                    best.set(id, Math.min(best.get(id) ?? Infinity, index + 1));
                }
            }
        });
    }
    return [...best].filter(([id]) => (substatIds as readonly string[]).includes(id))
        .map(([id, rank]) => ({ id, label: substatLabel(locale, id), rank }))
        .sort((a, b) => a.rank - b.rank);
}

export function getBuildMainStatSlots(locale: Locale, buildPath: string) {
    const mainStats: Partial<Record<SlotKey, StatEntry[]>> =
        loadJSON(buildPath, 'relic-mainstats.json')?.main_stats ?? {};

    return mainStatSlots.map(({ key, label, family }) => {
        const stats = (mainStats[key] ?? []).flatMap((item, index) => {
            const id = typeof item === 'string' ? item : item?.name;
            return id ? [{ id, label: statName(locale, item), rank: index + 1 }] : [];
        });

        return {
            key,
            family,
            label: t(locale, 'ui', label, undefined, false),
            stats,
            value: stats.map((stat) => stat.label).join(' / '),
        };
    });
}

export function getAllBuildMainStatSlots(locale: Locale, buildPaths: string[]) {
    const builds = buildPaths.map((build) => getBuildMainStatSlots(locale, build));
    return mainStatSlots.map(({ key, label, family }, index) => {
        const recommendations = builds.flatMap((slots) => slots[index].stats)
            .sort((a, b) => a.rank - b.rank);
        const recommended = new Map<string, RankedStat>();
        for (const stat of recommendations) {
            // The guides use Any for unrestricted slots and CR/CD for two alternatives.
            if (stat.id === 'ANY') continue;
            const ids = stat.id === 'cr/cd'
                ? ['cr', 'cd']
                : [stat.id];
            for (const rawId of ids) {
                // Some build guides omit the percent suffix on variable main stats.
                const id = ['hp', 'atk', 'def'].includes(rawId) ? rawId + '%' : rawId;
                if (!recommended.has(id)) {
                    recommended.set(id, { id, label: statName(locale, id), rank: stat.rank });
                }
            }
        }

        const extra = selectableMainStats[key]
            .filter((id) => !recommended.has(id))
            .map((id) => ({ id, label: statName(locale, id), rank: 0 }));
        return {
            key,
            family,
            label: t(locale, 'ui', label, undefined, false),
            stats: [...recommended.values(), ...extra],
            value: [...recommended.values()].map((stat) => stat.label).join(' / '),
        };
    });
}
