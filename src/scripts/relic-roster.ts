import type { OwnedSetUsage } from '../utils/relic-browser';
import {
    isRosterEvent, parseJson, readPlans, readRoster,
    readSetting, rosterKeys, saveSetting,
} from './roster-store';

type StatRow = { label: string; ranks: Map<string, number> };
type Slot = { label: string; stats: Map<string, StatRow> };
const unranked = Number.POSITIVE_INFINITY;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

type Substat = { id: string; label: string };

function statRow(rank: number, label: string, who: string) {
    const item = element('li', undefined, 'relic-owned-stat');
    const line = element('span', undefined, 'relic-owned-line');
    line.append(element('strong', label, 'relic-owned-name'));
    if (who) line.append(' ', element('span', who, 'relic-owned-who'));
    item.append(element('span', rank === unranked ? '–' : String(rank), 'relic-owned-rank'), line);
    return item;
}

function renderUsage(
    panel: HTMLElement,
    usage: OwnedSetUsage[],
    statsBySlot: Map<string, Slot>,
    substats: Map<string, StatRow>,
    allSubstats: Substat[],
    labels: Record<string, string | undefined>,
) {
    const characters = new Map<string, { name: string; href: string; rarity: string; pieces: Set<number> }>();
    for (const entry of usage) {
        const person = characters.get(entry.characterId) ?? {
            name: entry.characterName, href: entry.href, rarity: entry.characterRarity, pieces: new Set<number>(),
        };
        person.pieces.add(entry.pieces);
        characters.set(entry.characterId, person);
    }

    const names = element('ul', undefined, 'relic-owned-names');
    for (const person of [...characters.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const item = element('li');
        const pieces = [...person.pieces].sort((a, b) => b - a)
            .map((count) => count === 4 ? labels.labelFour : labels.labelTwo);
        const link = element('a', person.name + ' · ' + pieces.join(' / '),
            'artifact-set-usage-chip character-rarity-' + person.rarity);
        link.href = person.href;
        item.append(link);
        names.append(item);
    }

    const slots = [...statsBySlot.values()].map(({ label, stats }) => {
        const section = element('div', undefined, 'relic-owned-slot');
        const list = element('ul');
        const ordered = [...stats.values()].map(({ label, ranks }) => ({
            label, ranks, best: Math.min(...ranks.values()),
        })).sort((a, b) =>
            a.best - b.best || b.ranks.size - a.ranks.size || a.label.localeCompare(b.label),
        );

        for (const { label, ranks, best } of ordered) {
            list.append(statRow(best, label, whoList(ranks)));
        }
        section.append(element('h4', label), list);
        return section;
    });

    const neededList = element('ul');
    for (const { label, ranks } of [...substats.values()].sort((a, b) =>
        Math.min(...a.ranks.values()) - Math.min(...b.ranks.values()) ||
        b.ranks.size - a.ranks.size || a.label.localeCompare(b.label),
    )) {
        neededList.append(statRow(Math.min(...ranks.values()), label, whoList(ranks)));
    }
    const needed = element('div', undefined, 'relic-owned-slot');
    needed.append(element('h4', labels.labelSubstatsNeeded), neededList);

    const ignoredList = element('ul', undefined, 'relic-owned-ignored');
    for (const { id, label } of allSubstats) {
        if (!substats.has(id)) ignoredList.append(element('li', label));
    }
    const ignored = element('div', undefined, 'relic-owned-slot');
    ignored.append(element('h4', labels.labelSubstatsIgnored), ignoredList);

    panel.replaceChildren(
        names,
        ...slots,
        ...(substats.size ? [needed] : []),
        ...(ignoredList.children.length ? [ignored] : []),
    );

    function whoList(ranks: Map<string, number>) {
        return [...ranks].map(([id, rank]) => {
            const name = characters.get(id)?.name ?? '';
            return rank > 1 && rank < unranked ? name + ' #' + rank : name;
        }).sort((a, b) => a.localeCompare(b)).join(', ');
    }
}

function initRelicRoster(root: HTMLElement) {
    const form = document.querySelector<HTMLFormElement>('[data-relic-filters]');
    const filter = root.querySelector<HTMLSelectElement>('[data-relic-roster-filter]');
    const count = root.querySelector<HTMLElement>('[data-roster-count]');
    const mode = root.querySelector<HTMLSelectElement>('[data-relic-stat-mode]');
    const hideNames = root.querySelector<HTMLInputElement>('[data-relic-hide-names]');
    const hideRanked = root.querySelector<HTMLInputElement>('[data-relic-hide-ranked]');
    const characterSearch = form?.querySelector<HTMLInputElement>(
        '[data-relic-character-search]',
    );
    if (
        !form ||
        !filter ||
        !count ||
        !mode ||
        !hideNames ||
        !hideRanked ||
        !characterSearch
    ) return;

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-relic-view]')];
    const defaults = readPlans(parseJson(root.dataset.defaults ?? null));
    const knownIds = new Set(Object.keys(defaults));
    const allSubstats: Substat[] = JSON.parse(root.dataset.allSubstats ?? '[]');
    const cards = [...document.querySelectorAll<HTMLElement>('[data-relic-card]')].flatMap((card) => {
        const panel = card.querySelector<HTMLElement>('[data-relic-owned]');
        const usage: OwnedSetUsage[] = JSON.parse(card.dataset.usageJson ?? '[]');
        return panel ? [{ card, panel, usage }] : [];
    });

    function render() {
        if (!form || !filter || !count || !mode || !hideNames || !hideRanked) return;
        const { owned, plans } = readRoster(knownIds);
        const view = readSetting(rosterKeys.filter);
        filter.value = view === 'needed' || view === 'unneeded' ? view : '';
        mode.value = readSetting(rosterKeys.statMode) === 'top' ? 'top' : 'all';
        hideNames.checked = readSetting(rosterKeys.hideNames) === 'true';
        hideRanked.checked = readSetting(rosterKeys.hideRanked) === 'true';
        document.body.toggleAttribute('data-hide-ranked', hideRanked.checked);
        root.closest('[data-relic-browser]')?.toggleAttribute('data-hide-names', hideNames.checked);
        count.textContent = String(owned.size);

        const characterQuery = characterSearch.value.trim().toLowerCase();
        let needed = 0;
        for (const { card, panel, usage } of cards) {
            card.dataset.characterMatches = String(
                !characterQuery ||
                    usage.some(
                        ({ characterId, characterName, pieces }) => {
                            if (
                                !characterName
                                    .toLowerCase()
                                    .includes(characterQuery)
                            ) return false;
                            if (!owned.has(characterId)) return true;
                            const plan =
                                plans[characterId] ?? defaults[characterId];
                            return plan.sets.includes(
                                card.dataset.setId + ':' + pieces,
                            );
                        },
                    ),
            );
            const selected = usage.filter(({ characterId, pieces }) =>
                owned.has(characterId) &&
                (plans[characterId] ?? defaults[characterId]).sets.includes(card.dataset.setId + ':' + pieces),
            );
            card.dataset.roster = selected.length > 0 ? 'needed' : 'unneeded';
            if (selected.length === 0) {
                const message = owned.size ? root.dataset.notNeeded : root.dataset.noCharacters;
                panel.replaceChildren(element('p', message, 'artifact-set-usage-empty'));
                continue;
            }
            needed += 1;
            const statsBySlot = new Map<string, Slot>();
            const substats = new Map<string, StatRow>();
            for (const entry of selected) {
                for (const { id, label, rank } of entry.substats) {
                    const row = substats.get(id) ?? { label, ranks: new Map<string, number>() };
                    row.ranks.set(entry.characterId, rank);
                    substats.set(id, row);
                }
                const plan = plans[entry.characterId] ?? defaults[entry.characterId];
                for (const { key, label, stats } of entry.slots) {
                    const picked = stats.filter((stat) => plan.stats[key]?.includes(stat.id));
                    const chosen = mode.value === 'top' ? picked.slice(0, 1) : picked;
                    if (chosen.length === 0) continue;
                    const slot = statsBySlot.get(key) ?? { label, stats: new Map<string, StatRow>() };
                    for (const { id, label, rank } of chosen) {
                        const row = slot.stats.get(id) ?? { label, ranks: new Map<string, number>() };
                        row.ranks.set(entry.characterId, rank === 0 ? unranked : rank);
                        slot.stats.set(id, row);
                    }
                    statsBySlot.set(key, slot);
                }
            }
            renderUsage(panel, selected, statsBySlot, substats, allSubstats, root.dataset);
        }

        for (const button of buttons) {
            const value = button.dataset.relicView;
            button.setAttribute('aria-pressed', String(filter.value === value));
            const total = value === 'needed' ? needed : value === 'unneeded' ? cards.length - needed : cards.length;
            const output = button.querySelector<HTMLElement>('[data-view-count]');
            if (output) output.textContent = `(${total})`;
        }
        form.dispatchEvent(new Event('input', { bubbles: true }));
    }

    for (const button of buttons) {
        button.addEventListener('click', () => {
            saveSetting(rosterKeys.filter, button.dataset.relicView ?? '');
            render();
        });
    }
    for (const [control, key] of [
        [mode, rosterKeys.statMode],
        [hideNames, rosterKeys.hideNames],
        [hideRanked, rosterKeys.hideRanked],
    ] as const) {
        control.addEventListener('change', () => {
            saveSetting(key, control instanceof HTMLInputElement ? String(control.checked) : control.value);
            render();
        });
    }
    characterSearch.addEventListener('input', render);
    window.addEventListener('storage', (event) => {
        if (isRosterEvent(event) || Object.values(rosterKeys).some((key) => key === event.key)) {
            render();
        }
    });
    render();
}

const root = document.querySelector<HTMLElement>('[data-relic-roster]');
if (root) initRelicRoster(root);
