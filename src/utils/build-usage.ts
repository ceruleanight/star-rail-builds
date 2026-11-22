import {
    getPublicCharacterName,
    getPublicCharacterSlug,
} from './character-slugs';
import { loadJSON } from './content';
import { getCharacterBuilds, getContentCharacters } from './content-tree';
import { localizedPath } from './paths';

/**
 * One character chip shown under "ranked on" on the relic set page.
 */
export type BuildUsage = {
    characterName: string;
    characterRarity: string;
    href: string;
    isWip?: boolean;
    rank?: number;
    /** Folder name of the build this chip links to. */
    buildName: string;
    /** Absolute path of that build folder, used to read its stat recommendations. */
    buildPath: string;
};

type BuildUsageItem = {
    id: string | null;
    isWip?: boolean;
    rank?: number;
};

function collectStrings(value: any): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(collectStrings);
    if (value && typeof value === 'object') {
        return Object.values(value).flatMap(collectStrings);
    }

    return [];
}

/**
 * Finds items that a build only mentions inside a "work in progress" note.
 *
 * A note counts when it starts with `## [[note:wip-relic]]`. Every
 * `[[set:id]]` token inside that note is returned as a WIP item.
 *
 * @param buildNotes Parsed build-notes.json for one build.
 * @param noteKind Which WIP heading to look for.
 * @param itemKind Inline token category used for the item IDs.
 * @param normalizeId Alias resolver for short IDs.
 */
export function getWipNoteItems(
    buildNotes: any,
    noteKind: 'relic' | 'light-cone',
    itemKind: 'set' | 'light-cone',
    normalizeId: (id: string) => string,
): BuildUsageItem[] {
    const heading = `## [[note:wip-${noteKind}]]`;

    return collectStrings(buildNotes)
        .filter((note) => note.replaceAll('\r\n', '\n').startsWith(heading))
        .flatMap((note) =>
            [...note.matchAll(new RegExp(String.raw`\[\[${itemKind}:([^|\]]+)`, 'g'))].map(
                (match) => ({
                    id: normalizeId(match[1].trim()),
                    isWip: true,
                }),
            ),
        );
}

/**
 * Builds a reverse index from item ID to the characters that use it.
 *
 * Only builds marked `best: true` are scanned. Each character appears once
 * per item, keeping the best (lowest) rank found across their builds.
 * Characters are sorted with ranked entries first, WIP last, then by name.
 *
 * @param locale Locale bundle used for character display names.
 * @param lang Active language code used for links.
 * @param getItems Returns the item IDs (and optional ranks) for one build.
 */
export function getBestBuildUsage(
    locale: any,
    lang: string,
    getItems: (buildPath: string, buildNotes: any) => BuildUsageItem[],
) {
    const usageByItem = new Map<string, BuildUsage[]>();

    for (const character of getContentCharacters()) {
        const characterName = getPublicCharacterName(locale, character);
        const characterHref = localizedPath(
            lang,
            getPublicCharacterSlug(character),
        );

        for (const build of getCharacterBuilds(character.characterPath)) {
            const buildNotes = loadJSON(build.path, 'build-notes.json');

            if (buildNotes?.best !== true) continue;

            const href = `${characterHref}?build=${encodeURIComponent(build.name)}`;

            for (const { id, isWip, rank } of getItems(build.path, buildNotes)) {
                if (!id) continue;

                const usage = usageByItem.get(id) ?? [];
                const existing = usage.find((item) =>
                    item.href.startsWith(`${characterHref}?`),
                );

                if (!existing) {
                    usage.push({
                        characterName,
                        characterRarity: character.rarity,
                        href,
                        isWip,
                        rank,
                        buildName: build.name,
                        buildPath: build.path,
                    });
                } else if (existing.isWip && !isWip) {
                    Object.assign(existing, {
                        href,
                        isWip,
                        rank,
                        buildName: build.name,
                        buildPath: build.path,
                    });
                } else if (
                    existing.isWip === isWip &&
                    rank !== undefined &&
                    (existing.rank === undefined || rank < existing.rank)
                ) {
                    Object.assign(existing, {
                        href,
                        rank,
                        buildName: build.name,
                        buildPath: build.path,
                    });
                }

                usageByItem.set(id, usage);
            }
        }
    }

    for (const usage of usageByItem.values()) {
        usage.sort(
            (a, b) =>
                Number(!!a.isWip) - Number(!!b.isWip) ||
                a.characterName.localeCompare(b.characterName),
        );
    }

    return usageByItem;
}
