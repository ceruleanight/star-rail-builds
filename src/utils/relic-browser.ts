import path from 'path';
import { getCharacterPlanData } from './character-plans';
import { getBuildMainStatSlots, getSubstatOptions, statName, type RankedStat } from './build-stats';
import { collectSetItems, normalizeSetId } from './relic-set-items';
import {
    getBestBuildUsage,
    getWipNoteItems,
    type BuildUsage,
} from './build-usage';
import { loadJSON, readJSONFile, toTitleCase } from './content';
import { getLocale, t } from './i18n';
import { resolveRelicAssetImage } from './item-assets';

export type OwnedSetUsage = {
    characterId: string;
    characterName: string;
    characterRarity: string;
    href: string;
    isWip: boolean;
    pieces: number;
    substats: RankedStat[];
    slots: { key: string; label: string; stats: RankedStat[] }[];
};

const bonusKeys = ['2p', '4p'] as const;

/**
 * Pieces that define a set's "ranked on" list: Cavern Relics are ranked as
 * 4-piece sets, Planar Ornaments as 2-piece sets.
 */
const rankedPieces = { cavern: 4, planar: 2 } as const;

type RelicType = 'cavern' | 'planar';

type LocalizedRelicEffect = {
    en?: string;
    [lang: string]: string | undefined;
};

type RelicSetData = {
    type: RelicType;
    rarity: number;
    version_released?: string;
    tags?: string[];
    '2p'?: LocalizedRelicEffect;
    '4p'?: LocalizedRelicEffect;
};

type LabelRef = [string, string];

type TagOption = {
    id: string;
    label: LabelRef;
    tags: string[];
};

type TagOptionGroup = {
    label: LabelRef;
    options: TagOption[];
};

const tagOptionGroups: TagOptionGroup[] = [
    {
        label: ['ui', 'Stat'],
        options: [
            {
                id: 'spd',
                label: ['stat', 'spd'],
                tags: ['spd'],
            },
            {
                id: 'atk',
                label: ['stat', 'atk%'],
                tags: ['atk'],
            },
            {
                id: 'hp',
                label: ['stat', 'hp%'],
                tags: ['hp'],
            },
            {
                id: 'def',
                label: ['stat', 'def%'],
                tags: ['def'],
            },
            {
                id: 'crit-rate',
                label: ['stat', 'cr'],
                tags: ['crit-rate', 'cr'],
            },
            {
                id: 'crit-dmg',
                label: ['stat', 'cd'],
                tags: ['crit-dmg', 'cd'],
            },
            {
                id: 'effect-hit-rate',
                label: ['stat', 'ehr'],
                tags: ['effect-hit-rate', 'ehr'],
            },
            {
                id: 'effect-res',
                label: ['stat', 'effect-res'],
                tags: ['effect-res'],
            },
            {
                id: 'break-effect',
                label: ['stat', 'break-effect'],
                tags: ['break-effect'],
            },
            {
                id: 'energy-regen',
                label: ['stat', 'err'],
                tags: ['energy-regen', 'err'],
            },
        ],
    },
    {
        label: ['ui', 'Damage Type'],
        options: [
            {
                id: 'physical-dmg',
                label: ['stat', 'physical-dmg'],
                tags: ['physical-dmg'],
            },
            {
                id: 'fire-dmg',
                label: ['stat', 'fire-dmg'],
                tags: ['fire-dmg'],
            },
            {
                id: 'ice-dmg',
                label: ['stat', 'ice-dmg'],
                tags: ['ice-dmg'],
            },
            {
                id: 'lightning-dmg',
                label: ['stat', 'lightning-dmg'],
                tags: ['lightning-dmg'],
            },
            {
                id: 'wind-dmg',
                label: ['stat', 'wind-dmg'],
                tags: ['wind-dmg'],
            },
            {
                id: 'quantum-dmg',
                label: ['stat', 'quantum-dmg'],
                tags: ['quantum-dmg'],
            },
            {
                id: 'imaginary-dmg',
                label: ['stat', 'imaginary-dmg'],
                tags: ['imaginary-dmg'],
            },
        ],
    },
    {
        label: ['ui', 'Utility'],
        options: [
            {
                id: 'action-advance',
                label: ['ui', 'Action Advance'],
                tags: ['action-advance'],
            },
        ],
    },
];

const tagGroups: TagOption[] = tagOptionGroups.flatMap(
    (group) => group.options,
);

function getRelicTagGroups(tags: string[]) {
    const tagSet = new Set(tags);

    return tagGroups
        .filter((group) =>
            group.tags.some((tag) => tagSet.has(tag)),
        )
        .map((group) => group.id);
}

/**
 * Builds the "ranked on" indexes for relic sets.
 *
 * Only builds marked `best: true` are counted. Cavern Relics use 4-piece
 * mentions from `relic_sets`; Planar Ornaments use 2-piece mentions from
 * `planar_ornaments`. Conditional groups count without a rank number.
 */
function getRelicSetUsage(locale: any, lang: string) {
    const wipItems = (buildNotes: any) =>
        getWipNoteItems(buildNotes, 'relic', 'set', normalizeSetId);

    return {
        cavern: getBestBuildUsage(locale, lang, (buildPath, buildNotes) => [
            ...collectSetItems(
                loadJSON(buildPath, 'relic-sets.json'),
                rankedPieces.cavern,
                'relic_sets',
            ),
            ...wipItems(buildNotes),
        ]),
        planar: getBestBuildUsage(locale, lang, (buildPath, buildNotes) => [
            ...collectSetItems(
                loadJSON(buildPath, 'relic-sets.json'),
                rankedPieces.planar,
                'planar_ornaments',
            ),
            ...wipItems(buildNotes),
        ]),
    };
}

function escapeHtml(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Builds the hover card shown for one character chip: the main stats for the
 * four relic slots that vary (Body, Feet, Planar Sphere, Link Rope) and the
 * substat priority, all taken from the build the chip links to.
 */
function renderUsagePopoverHtml(locale: any, lang: string, usage: BuildUsage) {
    const mainStats = loadJSON(usage.buildPath, 'relic-mainstats.json')?.main_stats;
    const substats = loadJSON(usage.buildPath, 'relic-substats.json')?.substats_priority;

    if (!mainStats && !substats) return '';

    const buildNotes = loadJSON(usage.buildPath, 'build-notes.json');
    const buildName =
        buildNotes?.name?.[lang] ??
        buildNotes?.name?.en ??
        toTitleCase(usage.buildName);

    const slotRows = getBuildMainStatSlots(locale, usage.buildPath)
        .filter((slot) => slot.value)
        .map((slot) => `<div class="usage-popover-row"><span class="usage-popover-slot">${escapeHtml(slot.label)}</span><span class="usage-popover-value">${escapeHtml(slot.value)}</span></div>`)
        .join('');

    const substatChips = (substats ?? [])
        .map((entry: any, index: number) => {
            const items = Array.isArray(entry?.items) ? entry.items : [entry];
            const names = items.map((item: any) => statName(locale, item)).filter(Boolean);

            return names.length
                ? `<span class="usage-popover-sub"><strong>${index + 1}</strong>${escapeHtml(
                    names.join(' \u2248 '),
                )}</span>`
                : '';
        })
        .join('');

    return [
        `<span class="usage-popover-header"><span class="usage-popover-name">${escapeHtml(
            usage.characterName,
        )}</span><span class="usage-popover-build">${escapeHtml(buildName)}</span></span>`,
        slotRows
            ? `<span class="usage-popover-section"><span class="usage-popover-title">${escapeHtml(
                t(locale, 'ui', 'Main Stats', undefined, false),
            )}</span>${slotRows}</span>`
            : '',
        substatChips
            ? `<span class="usage-popover-section"><span class="usage-popover-title">${escapeHtml(
                t(locale, 'ui', 'Substats', undefined, false),
            )}</span><span class="usage-popover-subs">${substatChips}</span></span>`
            : '',
    ].join('');
}

function getRelicSetEntries(
    locale: any,
    lang: string,
    usage: ReturnType<typeof getRelicSetUsage>,
) {
    const filePath = path.resolve(
        'src/data/relics/relic_sets.json',
    );

    const relicData = readJSONFile(filePath) as Record<
        string,
        RelicSetData
    >;

    return Object.entries(relicData).map(
        ([id, info]) => {
            const bonuses = bonusKeys
                .map((key) => ({
                    id: key,
                    label: t(
                        locale,
                        'ui',
                        `${key[0]}-Pc`,
                        undefined,
                        false,
                    ),
                    html:
                        info[key]?.[lang] ??
                        info[key]?.en ??
                        '',
                }))
                .filter((bonus) => bonus.html);

            return {
                id,

                image: resolveRelicAssetImage(id),


                name: t(
                    locale,
                    'relic',
                    id,
                    undefined,
                    false,
                ),

                type: info.type,

                rarity: info.rarity,

                versionReleased:
                    info.version_released ?? '',

                bonuses,

                tags: info.tags ?? [],

                usagePieces: rankedPieces[info.type] ?? 4,

                rankedOn: ((usage[info.type] ?? usage.cavern).get(id) ?? []).map(
                    (entry) => ({
                        ...entry,
                        popoverHtml: renderUsagePopoverHtml(locale, lang, entry),
                    }),
                ),

                tagGroups: getRelicTagGroups(
                    info.tags ?? [],
                ),
            };
        },
    );
}

export function getRelicSetBrowserData(
    lang = 'en',
) {
    const locale = getLocale(lang);

    const relicTypeOrder = {
        cavern: 0,
        planar: 1,
    } as const;

    const characters = getCharacterPlanData(lang);
    const characterDefaults = Object.fromEntries(characters.map(({ id, defaults }) => [id, defaults]));
    const ownedUsage = new Map<string, OwnedSetUsage[]>();
    for (const character of characters) {
        for (const section of character.sections) {
            for (const set of section.sets) {
                const usage = ownedUsage.get(set.setId) ?? [];
                usage.push({
                    characterId: character.id, characterName: character.name, characterRarity: character.rarity,
                    href: set.href, isWip: set.isWip, pieces: set.pieces,
                    substats: character.substats,
                    slots: character.slots.filter((slot) => slot.family === section.family)
                        .map(({ key, label, stats }) => ({ key, label, stats })),
                });
                ownedUsage.set(set.setId, usage);
            }
        }
    }

    const relicSets = getRelicSetEntries(
        locale,
        lang,
        getRelicSetUsage(locale, lang),
    ).map((set) => ({ ...set, ownedUsage: ownedUsage.get(set.id) ?? [] })).sort((a, b) => {
        const byType =
            relicTypeOrder[a.type] -
            relicTypeOrder[b.type];

        if (byType !== 0) {
            return byType;
        }

        return a.name.localeCompare(b.name);
    });

    const visibleTagOptionGroups =
        tagOptionGroups
            .map((group) => ({
                label: t(
                    locale,
                    group.label[0],
                    group.label[1],
                    undefined,
                    false,
                ),

                options: group.options
                    .filter((option) =>
                        relicSets.some((relicSet) =>
                            relicSet.tagGroups.includes(
                                option.id,
                            ),
                        ),
                    )
                    .map((option) => ({
                        id: option.id,

                        label: t(
                            locale,
                            option.label[0],
                            option.label[1],
                            undefined,
                            false,
                        ),
                    })),
            }))
            .filter(
                (group) =>
                    group.options.length > 0,
            );

    return {
        relicSets,
        characterDefaults,
        allSubstats: getSubstatOptions(locale),
        lang,
        locale,
        tagOptionGroups:
            visibleTagOptionGroups,
    };
}