import translationAliases from '../data/translation-aliases.json';
import relicData from '../data/relics/relic_sets.json';
import relicGroups from '../data/relics/relic_groups.json';

type SetItem = { name: string; pieces: number };
type SetGroup = { items?: SetItem[]; choices?: { items?: SetItem[] }[] };
type RankedEntry = { groups: SetGroup[] };
type ConditionalEntry = SetGroup & { groups?: SetGroup[] };
type SetRecommendations = {
    relic_sets?: RankedEntry[];
    planar_ornaments?: RankedEntry[];
    conditional?: ConditionalEntry[];
};
type Recommendation = { id: string; rank: number | undefined };

const aliases: Record<string, string> = translationAliases.set;
const groups: Record<string, { pieces: number; sets: string[] }> = relicGroups;
export const relicSets: Readonly<Record<string, { type: string }>> = relicData;

export function normalizeSetId(id: string) {
    return Object.hasOwn(aliases, id) ? aliases[id] : id;
}

function getGroupItems(group: SetGroup) {
    return [...(group.items ?? []), ...(group.choices ?? []).flatMap((choice) => choice.items ?? [])];
}

export function collectSetItems(
    data: SetRecommendations | null,
    pieces: number,
    rankedKey: 'relic_sets' | 'planar_ornaments',
): Recommendation[] {
    const ranked = (data?.[rankedKey] ?? []).flatMap((entry, index) =>
        entry.groups.flatMap(getGroupItems).map((item) => ({ item, rank: index + 1 })),
    );
    const conditional = (data?.conditional ?? []).flatMap((entry) =>
        (entry.groups ?? [entry]).flatMap(getGroupItems).map((item) => ({ item, rank: undefined })),
    );

    const type = rankedKey === 'relic_sets' ? 'cavern' : 'planar';
    return [...ranked, ...conditional].flatMap(({ item, rank }) => {
        if (Number(item.pieces) !== pieces || !item.name) return [];
        const group = Object.hasOwn(groups, item.name) ? groups[item.name] : undefined;
        if (group && group.pieces !== pieces) return [];

        return (group?.sets ?? [item.name])
            .map(normalizeSetId)
            .filter((id) => Object.hasOwn(relicSets, id) && relicSets[id].type === type)
            .map((id) => ({ id, rank }));
    });
}
