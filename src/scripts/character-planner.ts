import { compareCharacterCards } from './character-sort.mjs';
import {
    isRecord, isRosterEvent, parseJson, readPlans, readRoster,
    rosterApp, rosterKeys, saveSetting, stringList, type Plan,
} from './roster-store';

function initPlanner(root: HTMLElement) {
    const grid = root.querySelector<HTMLElement>('[data-plan-grid]');
    const sort = root.querySelector<HTMLSelectElement>('[data-character-sort]');
    const search = root.querySelector<HTMLInputElement>('[data-roster-search]');
    const transfer = root.querySelector<HTMLTextAreaElement>('[data-roster-transfer]');
    const file = root.querySelector<HTMLInputElement>('[data-roster-file]');
    const status = root.querySelector<HTMLElement>('[data-roster-status]');
    const count = root.querySelector<HTMLElement>('[data-roster-count]');
    const empty = root.querySelector<HTMLElement>('[data-plan-empty]');
    if (!grid || !sort || !search || !transfer || !file || !status || !count || !empty) return;

    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-plan-card]'));
    const byId = new Map(cards.map((card) => [card.dataset.id ?? '', card]));
    const knownIds = new Set(byId.keys());
    const defaults = readPlans(Object.fromEntries(cards.map((card) => [
        card.dataset.id,
        parseJson(card.dataset.defaults ?? null),
    ])));
    const roster = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-roster-character]'));
    const groups = Array.from(root.querySelectorAll<HTMLElement>('[data-roster-group]'));
    let { owned, plans } = readRoster(knownIds);

    function cleanPlan(card: HTMLElement, plan: Plan): Plan {
        const sets = [...card.querySelectorAll<HTMLButtonElement>('[data-plan-set]')]
            .map((chip) => chip.dataset.key ?? '')
            .filter((key) => plan.sets.includes(key));
        const stats: Plan['stats'] = {};
        for (const chip of card.querySelectorAll<HTMLButtonElement>('[data-plan-stat]')) {
            const { slot, stat } = chip.dataset;
            if (!slot || !stat) continue;
            const picked = stats[slot] ??= [];
            if (plan.stats[slot]?.includes(stat)) picked.push(stat);
        }
        return { sets, stats };
    }

    function getPlan(id: string) {
        return plans[id] ?? defaults[id];
    }

    function savePlans() {
        saveSetting(rosterKeys.plans, JSON.stringify(plans));
    }

    function ensurePlans() {
        let changed = false;
        for (const id of owned) {
            const card = byId.get(id);
            if (!card) continue;
            const plan = cleanPlan(card, getPlan(id));
            if (JSON.stringify(plans[id]) === JSON.stringify(plan)) continue;
            plans[id] = plan;
            changed = true;
        }
        if (changed) savePlans();
    }

    function render() {
        if (!count || !empty) return;
        count.textContent = String(owned.size);
        empty.hidden = owned.size > 0;
        for (const chip of roster) {
            chip.setAttribute('aria-pressed', String(owned.has(chip.dataset.id ?? '')));
        }
        for (const [id, card] of byId) {
            card.hidden = !owned.has(id);
            if (card.hidden) continue;
            const plan = getPlan(id);
            for (const chip of card.querySelectorAll<HTMLButtonElement>('[data-plan-set], [data-plan-stat]')) {
                const { key, slot, stat } = chip.dataset;
                const selected = key ? plan.sets.includes(key) : plan.stats[slot ?? '']?.includes(stat ?? '');
                chip.setAttribute('aria-pressed', String(Boolean(selected)));
            }
        }
    }

    function updateRoster() {
        ensurePlans();
        saveSetting(rosterKeys.owned, JSON.stringify([...owned]));
        render();
    }

    function searchRoster() {
        const query = search?.value.trim().toLowerCase() ?? '';
        for (const chip of roster) {
            chip.hidden = !(chip.textContent ?? '').toLowerCase().includes(query);
        }
        for (const group of groups) {
            group.hidden = !group.querySelector('[data-roster-character]:not([hidden])');
        }
    }

    function sortCards() {
        if (sort && grid) {
            grid.append(...cards.toSorted((a, b) => compareCharacterCards(a, b, sort.value)));
        }
    }

    function exportRoster() {
        return JSON.stringify({
            app: rosterApp, version: 2, owned: [...owned],
            plans: Object.fromEntries([...owned].map((id) => [id, getPlan(id)])),
        }, null, 2);
    }

    function importRoster(raw: string) {
        if (!status) return;
        const value = raw.trim();
        const parsed = parseJson(value);
        const payload = isRecord(parsed) ? parsed : null;
        const plain = parsed === null && value && !/^[{\[]/.test(value);
        const ids = payload ? payload.owned : plain ? value.split(/[\s,]+/).filter(Boolean) : parsed;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') ||
            (payload && payload.app !== undefined && payload.app !== rosterApp) ||
            (payload && payload.version !== undefined && ![1, 2].includes(Number(payload.version)))) {
            status.textContent = root.dataset.importInvalid ?? '';
            return;
        }
        const incoming = readPlans(payload?.plans);
        const unique = stringList(ids);
        owned = new Set(unique.filter((id) => knownIds.has(id)));
        for (const id of owned) {
            const card = byId.get(id);
            if (card) plans[id] = cleanPlan(card, Object.hasOwn(incoming, id) ? incoming[id] : defaults[id]);
        }
        savePlans();
        updateRoster();
        const ignored = unique.length - owned.size;
        status.textContent = (root.dataset.imported ?? '').replace('{count}', String(owned.size)) +
            (ignored ? ' ' + (root.dataset.importIgnored ?? '').replace('{count}', String(ignored)) : '');
    }

    root.addEventListener('click', async (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (!button) return;
        const card = button.closest<HTMLElement>('[data-plan-card]');
        const id = card?.dataset.id ?? button.dataset.id ?? '';
        if (button.hasAttribute('data-roster-character')) {
            if (!owned.delete(id)) owned.add(id);
            updateRoster();
        } else if (button.hasAttribute('data-roster-all')) {
            owned = new Set(knownIds);
            updateRoster();
        } else if (button.hasAttribute('data-roster-clear')) {
            owned.clear();
            updateRoster();
        } else if (card && owned.has(id)) {
            const plan = button.hasAttribute('data-plan-reset')
                ? structuredClone(defaults[id])
                : cleanPlan(card, getPlan(id));
            const { key, slot, stat } = button.dataset;
            const values = key ? plan.sets : slot ? plan.stats[slot] : undefined;
            const choice = key ?? stat;
            if (values && choice) {
                const index = values.indexOf(choice);
                if (index >= 0) values.splice(index, 1);
                else values.push(choice);
            }
            plans[id] = cleanPlan(card, plan);
            savePlans();
            render();
        } else if (button.hasAttribute('data-roster-copy')) {
            transfer.value = exportRoster();
            try {
                await navigator.clipboard.writeText(transfer.value);
                status.textContent = root.dataset.copied ?? '';
            } catch {
                transfer.focus();
                transfer.select();
                status.textContent = root.dataset.copyFailed ?? '';
            }
        } else if (button.hasAttribute('data-roster-download')) {
            const url = URL.createObjectURL(new Blob([exportRoster()], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = rosterApp + '-roster.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } else if (button.hasAttribute('data-roster-import')) {
            importRoster(transfer.value);
        }
    });

    file.addEventListener('change', async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        try {
            importRoster(await selected.text());
        } catch {
            status.textContent = root.dataset.importInvalid ?? '';
        }
        file.value = '';
    });
    search.addEventListener('input', searchRoster);
    sort.addEventListener('change', sortCards);
    window.addEventListener('storage', (event) => {
        if (!isRosterEvent(event)) return;
        ({ owned, plans } = readRoster(knownIds));
        render();
    });

    ensurePlans();
    searchRoster();
    sortCards();
    render();
}

const root = document.querySelector<HTMLElement>('[data-character-planner]');
if (root) initPlanner(root);
