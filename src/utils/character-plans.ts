import { getWipNoteItems } from './build-usage';
import { getAllBuildMainStatSlots, getAllBuildSubstats } from './build-stats';
import { getPublicCharacterName, getPublicCharacterSlug } from './character-slugs';
import { loadJSON, normalizeVersion, readJSONFile, toTitleCase } from './content';
import { getCharacterBuilds, getContentCharacters } from './content-tree';
import { getLocale, t } from './i18n';
import { resolveRelicAssetUrl } from './item-assets';
import { localizedPath } from './paths';
import { collectSetItems, normalizeSetId, relicSets } from './relic-set-items';
import { TranslationHelper } from './translator';
import type { Plan } from '../scripts/roster-store';

const setSections = [
    { key: 'relic-four', family: 'cavern', pieces: 4, label: '4-piece Cavern Relics' },
    { key: 'planar-two', family: 'planar', pieces: 2, label: '2-piece Planar Ornaments' },
    { key: 'relic-two', family: 'cavern', pieces: 2, label: '2-piece Cavern Relics' },
] as const;

export function getCharacterPlanData(lang: string) {
    const locale = getLocale(lang);
    const translator = new TranslationHelper(locale, {}, lang);
    return getContentCharacters().flatMap((character) => {
        const builds = getCharacterBuilds(character.characterPath)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((build) => ({
                ...build,
                notes: loadJSON(build.path, 'build-notes.json'),
                sets: loadJSON(build.path, 'relic-sets.json'),
            }))
            .filter((build) => build.notes?.best === true);
        if (builds.length === 0) return [];

        const id = getPublicCharacterSlug(character);
        const name = getPublicCharacterName(locale, character);
        const metadata = readJSONFile(character.metadataPath);
        const path = typeof metadata.path === 'string' ? metadata.path : '';
        const href = (build: string) => localizedPath(lang, id) + '?build=' + encodeURIComponent(build);
        const buildLabels = builds.map(({ notes, name }) => translator.translateNoteText(
            notes.name?.[lang] ?? notes.name?.en ?? toTitleCase(name),
        ));

        const sections = setSections.map((section) => {
            const rankedKey = section.family === 'cavern' ? 'relic_sets' : 'planar_ornaments';
            const ranked = builds.flatMap((build) =>
                collectSetItems(build.sets, section.pieces, rankedKey)
                    .map((item) => ({ ...item, href: href(build.name), isWip: false })),
            ).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
            const wip = builds.flatMap((build) =>
                getWipNoteItems(build.notes, 'relic', 'set', normalizeSetId).flatMap((item) =>
                    item.id && Object.hasOwn(relicSets, item.id) &&
                    relicSets[item.id].type === section.family && section.key !== 'relic-two'
                        ? [{ id: item.id, rank: undefined, href: href(build.name), isWip: true }]
                        : [],
                ),
            );
            const unique = new Map<string, (typeof ranked)[number]>();
            for (const set of [...ranked, ...wip]) {
                if (!unique.has(set.id)) unique.set(set.id, set);
            }
            const sets = [...unique.values()].map((set) => ({
                key: set.id + ':' + section.pieces,
                setId: set.id,
                pieces: section.pieces,
                name: t(locale, 'relic', set.id, undefined, false),
                image: resolveRelicAssetUrl(set.id),
                href: set.href,
                rank: set.rank,
                isWip: set.isWip,
            }));
            return { ...section, label: t(locale, 'ui', section.label), sets };
        });
        const sets = sections.flatMap((section) => section.sets);
        const slots = getAllBuildMainStatSlots(locale, builds.map((build) => build.path));
        const substats = getAllBuildSubstats(locale, builds.map((build) => build.path));
        const defaults: Plan = {
            sets: [4, 2].flatMap((pieces) => {
                const first = sets.find((set) => set.pieces === pieces && !set.isWip);
                return first ? [first.key] : [];
            }),
            stats: Object.fromEntries(slots.map(({ key, stats }) => [
                key,
                stats[0]?.rank > 0 ? [stats[0].id] : [],
            ])),
        };

        return [{
            id,
            name,
            rarity: character.rarity,
            element: character.type,
            elementLabel: t(locale, 'type', character.type),
            href: href(builds[0].name),
            buildLabel: [...new Set(buildLabels)].join(' / '),
            path,
            pathLabel: path ? t(locale, 'path', path) : '',
            releaseDate: typeof metadata.release_date === 'string' ? metadata.release_date : '',
            versionReleased: normalizeVersion(metadata.version_released),
            sets,
            sections,
            slots,
            substats,
            defaults,
        }];
    }).sort((a, b) =>
        a.elementLabel.localeCompare(b.elementLabel) ||
        Number(b.rarity) - Number(a.rarity) ||
        a.name.localeCompare(b.name),
    );
}
