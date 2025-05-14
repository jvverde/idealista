// ==UserScript==
// @name         Idealista Tracker Ultimate
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Rastreamento avançado com histórico completo e status de disponibilidade
// @author       Você
// @match        https://www.idealista.pt/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// @grant        GM.deleteValue
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/global/luxon.min.js
// ==/UserScript==

(() => {
    'use strict';
    const { DateTime } = luxon;
    const STORAGE_PREFIX = 'idealista_tracker_v7_';
    const NOW = DateTime.now().toISO();
    const DEBOUNCE_DELAY = 500;

    // Configuration
    const config = {
        isScriptUpdatingUI: false,
        refreshTimeout: null,
        priceFormatter: new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }),
        translations: {
            transaction: { rent: 'Arrendar', sale: 'Comprar' },
            property: {
                houses: 'Casas',
                apartments: 'Apartamentos',
                rooms: 'Quartos',
                offices: 'Escritórios',
                parking: 'Garagens',
                lands: 'Terrenos'
            },
            sorting: {
                'precos-desc': '↓ Preço',
                'precos-asc': '↑ Preço',
                'atualizado-desc': '↓ Atualizado',
                'area-desc': '↓ Área',
                'default': 'Padrão'
            }
        }
    };

    // Helper functions
    const formatPrice = price => config.priceFormatter.format(price);
    const formatDate = isoDate => isoDate ? DateTime.fromISO(isoDate).toFormat('yyyy-MM-dd HH:mm') : 'N/A';
    const parsePrice = text => parseInt(text.replace(/[^\d]/g, '')) || 0;
    const parseArea = text => (text.match(/(\d+)\s*m²/) || [])[1] || 0;

    // URL and context handling
    const isListingPage = () => {
        const path = window.location.pathname.toLowerCase();
        return /^\/(comprar|arrendar)-.+/.test(path) &&
               !/(imovel|blog|ajuda|contato|mapa|pagina-\d+)/.test(path);
    };

    const getPageContext = () => {
        const url = new URL(window.location.href);
        const [trans, type] = url.pathname.split('/')[1]?.split('-') || [];
        const [loc, subLoc] = url.pathname.split('/').slice(2, 4);

        return {
            isAreaSearch: url.searchParams.has('shape'),
            transactionType: {arrendar:'rent', comprar:'sale', venda:'sale'}[trans] || '',
            propertyType: {
                casas:'houses', apartamentos:'apartments', quartos:'rooms',
                escritorios:'offices', garagens:'parking', terrenos:'lands'
            }[type] || 'other',
            location: loc || '',
            subLocation: subLoc || '',
            ordem: url.searchParams.get('ordem') || 'default'
        };
    };

    const getStorageKey = ctx =>
        `${STORAGE_PREFIX}${ctx.isAreaSearch ? 'area_' : ''}${ctx.transactionType}_${ctx.propertyType}_` +
        `${ctx.location}_${ctx.subLocation}_${ctx.ordem}`.replace(/_+$/, '');

    // Data management
    const loadData = async ctx => {
        try {
            return JSON.parse(await GM.getValue(getStorageKey(ctx), '{}')) || {};
        } catch (e) {
            console.error('Erro ao carregar dados:', e);
            return {};
        }
    };

    const saveData = async (ctx, data) => {
        try {
            await GM.setValue(getStorageKey(ctx), JSON.stringify(data));
        } catch (e) {
            console.error('Erro ao salvar dados:', e);
        }
    };

    const updatePropertyStatus = async (id, isActive) => {
        try {
            const keys = (await GM.listValues()).filter(k => k.startsWith(STORAGE_PREFIX));
            await Promise.all(keys.map(async key => {
                const data = JSON.parse(await GM.getValue(key, '{}'));
                if (data[id]) {
                    data[id].lastSeen = NOW;
                    data[id].isActive = isActive;
                    await GM.setValue(key, JSON.stringify(data));
                }
            }));
        } catch (e) {
            console.error('Erro ao atualizar status:', e);
        }
    };

    // Property extraction
    const extractPropertyInfo = item => {
        const link = item.querySelector('a.item-link[href^="/imovel/"]');
        if (!link) return null;

        const url = 'https://www.idealista.pt' + link.getAttribute('href');
        const id = (url.match(/imovel\/(\d+)/) || [])[1];
        if (!id) return null;

        const priceElement = item.querySelector('.price-row .item-price');
        const typologyElement = item.querySelector('.item-detail-char .item-detail');
        const areaElement = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
            .find(el => el.textContent.includes('m²'));

        return {
            id,
            url,
            price: parsePrice(priceElement?.textContent || ''),
            typology: (typologyElement?.textContent.match(/(T\d+|Quarto|Estúdio)/i) || [])[0] || 'N/A',
            area: (areaElement?.textContent.match(/(\d+)\s*m²/) || [])[0] || 'N/A',
            hasGarage: !!item.querySelector('.item-parking, [title*="garagem"]'),
            isActive: true
        };
    };

    // UI Components
    GM_addStyle(`
        #idealistaPanel {
            position: fixed; top: 10px; right: 10px; width: 850px; max-height: 90vh;
            background: white; border: 1px solid #e0e0e0; border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 10000;
            font-family: 'Segoe UI', Arial, sans-serif; display: flex; flex-direction: column;
        }
        #idealistaHeader {
            padding: 12px 15px; background: #34495e; color: white;
            border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;
        }
        #idealistaTable {
            width: 100%; border-collapse: collapse; font-size: 13px;
            overflow-y: auto; max-height: calc(90vh - 100px);
        }
        #idealistaTable th {
            position: sticky; top: 0; background: #2c3e50; color: white;
            padding: 8px 10px; text-align: left; font-weight: 500; cursor: pointer;
        }
        #idealistaTable td {
            padding: 8px 10px; border-bottom: 1px solid #ecf0f1; vertical-align: top;
        }
        .price-cell { font-weight: bold; white-space: nowrap; }
        .price-up { color: #e74c3c; }
        .price-down { color: #27ae60; }
        .price-same { color: #3498db; }
        .status-active-row { background-color: #e8f5e9 !important; }
        .status-inactive-row { background-color: #ffebee !important; }
        .sort-arrow { margin-left: 5px; }
        .idealista-button {
            background: #2c3e50; color: white; border: none; border-radius: 4px;
            padding: 6px 12px; cursor: pointer; font-size: 12px; margin-left: 5px;
        }
        .idealista-button.danger { background: #e74c3c; }
        .context-badge {
            background: #9b59b6; color: white; padding: 2px 6px;
            border-radius: 4px; font-size: 12px; margin-left: 8px;
        }
    `);

    const setupTableSorting = () => {
        const table = document.getElementById('idealistaTable');
        if (!table) return;

        const sortableColumns = ['Tipo', 'Preço', 'Área', '1ª Detecção', 'Últ. Atualização'];
        const sortFunctions = [
            (a, b) => a.localeCompare(b),
            (a, b) => parsePrice(a) - parsePrice(b),
            () => 0,
            (a, b) => parseArea(a) - parseArea(b),
            (a, b) => new Date(a) - new Date(b),
            (a, b) => new Date(a) - new Date(b)
        ];

        let currentSort = { column: null, direction: 1 };

        const sortTable = (columnIndex) => {
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.rows);

            rows.sort((a, b) => {
                const aVal = a.cells[columnIndex].textContent.trim();
                const bVal = b.cells[columnIndex].textContent.trim();
                return sortFunctions[columnIndex](aVal, bVal) * currentSort.direction;
            });

            rows.forEach(row => tbody.appendChild(row));
        };

        table.querySelectorAll('th').forEach((header, index) => {
            if (!sortableColumns.includes(header.textContent.trim())) return;

            header.addEventListener('click', () => {
                table.querySelectorAll('th').forEach(h => h.textContent = h.textContent.replace(/↑|↓/g, '').trim());

                currentSort.direction = currentSort.column === index ? -currentSort.direction : 1;
                currentSort.column = index;

                header.textContent += ` ${currentSort.direction === 1 ? '↑' : '↓'}`;

                sortTable(index);
            });
        });
    };

    const translateContext = ctx => {
        const { transaction, property, sorting } = config.translations;
        const loc = ctx.location ?
            ` em ${ctx.location.replace(/-/g, ' ')}${ctx.subLocation ? ` > ${ctx.subLocation.replace(/-/g, ' ')}` : ''}` : '';

        return `${transaction[ctx.transactionType]} ${property[ctx.propertyType]}${loc} | ${
            sorting[ctx.ordem] || ctx.ordem
        }`;
    };

    const renderPriceTrend = prop => {
        if (!prop.history?.length) return '<span class="price-same">→ Estável</span>';

        const last = prop.history[prop.history.length - 1];
        const diff = last.change;
        const absDiff = Math.abs(diff);
        const pct = Math.round((absDiff / last.oldPrice) * 100);

        if (diff > 0) return `<span class="price-up">↑ +${formatPrice(absDiff)} (+${pct}%)</span>`;
        if (diff < 0) return `<span class="price-down">↓ -${formatPrice(absDiff)} (-${pct}%)</span>`;
        return '<span class="price-same">→ Igual</span>';
    };

    const createPropertyRow = prop => `
        <tr class="${prop.isActive ? 'status-active-row' : 'status-inactive-row'}">
            <td>${prop.typology}</td>
            <td class="price-cell">${formatPrice(prop.price)}</td>
            <td>${renderPriceTrend(prop)}</td>
            <td>${prop.area}</td>
            <td>${formatDate(prop.firstSeen)}</td>
            <td>${formatDate(prop.lastSeen)}</td>
            <td><a href="${prop.url}" target="_blank">${prop.id}</a></td>
        </tr>
    `;

    const createUI = async () => {
        if (config.isScriptUpdatingUI) return;
        config.isScriptUpdatingUI = true;

        try {
            const ctx = getPageContext();
            if (!ctx.transactionType) return;

            const currentItems = Array.from(document.querySelectorAll('article.item'));
            const currentIds = currentItems
                .map(item => item.querySelector('a.item-link[href^="/imovel/"]')?.getAttribute('href').match(/imovel\/(\d+)/)?.[1])
                .filter(Boolean);

            const data = await loadData(ctx);
            let newCount = 0;

            currentItems.forEach(item => {
                const prop = extractPropertyInfo(item);
                if (!prop) return;

                if (!data[prop.id]) {
                    prop.firstSeen = NOW;
                    prop.initialPrice = prop.price;
                    if (!ctx.isAreaSearch) {
                        prop.location = ctx.location;
                        prop.subLocation = ctx.subLocation;
                    }
                    newCount++;
                }

                data[prop.id] = { ...(data[prop.id] || {}), ...prop, lastSeen: NOW, isActive: true };
            });

            if (!ctx.isAreaSearch) {
                Object.keys(data).forEach(id => {
                    if (!currentIds.includes(id)) {
                        data[id].isActive = false;
                        updatePropertyStatus(id, false);
                    }
                });
            }

            await saveData(ctx, data);

            const displayData = Object.values(data).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            const panel = document.createElement('div');
            panel.id = 'idealistaPanel';
            panel.innerHTML = `
                <div id="idealistaHeader">
                    <h3>📊 Idealista Tracker <span class="context-badge">${translateContext(ctx)}</span></h3>
                    <button id="idealistaClose">✕</button>
                </div>
                <div id="idealistaContent">
                    <table id="idealistaTable">
                        <thead><tr>
                            <th>Tipo</th><th>Preço</th><th>Variação</th><th>Área</th>
                            <th>1ª Detecção</th><th>Últ. Atualização</th><th>Link</th>
                        </tr></thead>
                        <tbody>${displayData.map(createPropertyRow).join('')}</tbody>
                    </table>
                </div>
                <div id="idealistaFooter">
                    <div>${currentItems.length} ativos | ${displayData.length} totais | ${newCount} novos</div>
                    <div>
                        <button id="idealistaExport" class="idealista-button">📁 Exportar</button>
                        <button id="idealistaClearContext" class="idealista-button danger">🗑️ Limpar Esta Pesquisa</button>
                    </div>
                </div>
            `;

            panel.querySelector('#idealistaClose').addEventListener('click', () => panel.remove());

            panel.querySelector('#idealistaExport').addEventListener('click', async () => {
                const headers = [
                    'ID', 'Tipologia', 'Preço Inicial', 'Preço Atual', 'Primeira Detecção',
                    'Última Atualização', 'Status', 'Área', 'Garagem', 'Localidade', 'Sub-localidade', 'URL'
                ];

                const rows = displayData.map(p => [
                    p.id, p.typology, p.initialPrice, p.price, p.firstSeen, p.lastSeen,
                    p.isActive ? 'Ativo' : 'Inativo', p.area, p.hasGarage ? 'Sim' : 'Não',
                    p.location || '', p.subLocation || '', p.url
                ]);

                const csv = [headers, ...rows].map(row => row.join(';')).join('\n');

                await GM_setClipboard(csv, 'text');
                alert(`Dados exportados para ${displayData.length} imóveis!`);
            });

            panel.querySelector('#idealistaClearContext').addEventListener('click', async () => {
                if (confirm(`⚠️ Apagar dados para:\n"${translateContext(ctx)}"?`)) {
                    await GM.deleteValue(getStorageKey(ctx));
                    panel.remove();
                }
            });

            document.body.appendChild(panel);
            setupTableSorting();
        } finally {
            config.isScriptUpdatingUI = false;
        }
    };

    // Initialization and DOM observation
    const refreshUI = async () => {
        clearTimeout(config.refreshTimeout);
        document.getElementById('idealistaPanel')?.remove();
        await createUI();
    };

    const setupDOMObserver = () => {
        const observer = new MutationObserver(mutations => {
            if (config.isScriptUpdatingUI) return;

            const hasNewItems = mutations.some(m =>
                !(m.target.id === 'idealistaPanel' || m.target.closest('#idealistaPanel')) &&
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (n.matches('article.item') || n.querySelector('article.item'))
            ));

            if (hasNewItems) {
                clearTimeout(config.refreshTimeout);
                config.refreshTimeout = setTimeout(refreshUI, DEBOUNCE_DELAY);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    };

    const init = async () => {
        if (!isListingPage()) return console.log('[Idealista] Não é página de listagem');

        if (document.querySelector('article.item')) {
            await createUI();
            setupDOMObserver();
            return;
        }

        const observer = new MutationObserver((_, obs) => {
            if (document.querySelector('article.item')) {
                obs.disconnect();
                createUI();
                setupDOMObserver();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    };

    if (document.readyState === 'complete') {
        setTimeout(init, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1000));
    }
})();