// ==UserScript==
// @name         Idealista Price Tracker Ultimate
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Persistência completa de todos os imóveis com histórico de preços
// @author       Você
// @match        https://www.idealista.pt/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM.getValue
// @grant        GM.setValue
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/global/luxon.min.js
// ==/UserScript==

(function() {
    'use strict';
    const DateTime = luxon.DateTime;
    console.log('[Idealista Tracker] Iniciando monitoramento...');

    // ===== CONFIGURAÇÕES ===== //
    const STORAGE_KEY = 'idealista_ultimate_tracker_v2';
    const TODAY = DateTime.now().toFormat('dd/MM/yyyy');
    const DEBUG_MODE = true;

    // ===== VERIFICAÇÃO DE URL ===== //
    function isListingPage() {
        const path = window.location.pathname.toLowerCase();
        const validPatterns = [
            /\/arrendar\-casas\//i,
            /\/venda\-casas\//i,
            /\/comprar\-casas\//i,
            /\/pesquisar\-casas\//i,
            /\/areas\/arrendar\-casas\//i,
            /\/areas\/venda\-casas\//i,
            /\/(casas|apartamentos|moradias)\//i
        ];

        const invalidPatterns = [
            /\/imovel\//i,
            /\/blog\//i,
            /\/ajuda\//i,
            /\/contato\//i,
            /\/perfil\//i
        ];

        return validPatterns.some(p => p.test(path)) &&
               !invalidPatterns.some(p => p.test(path));
    }

    if (!isListingPage()) {
        DEBUG_MODE && console.log('[Debug] Não é página de listagem - abortando');
        return;
    }

    // ===== SISTEMA DE ARMAZENAMENTO ===== //
    async function loadProperties() {
        try {
            const data = await GM.getValue(STORAGE_KEY, '{}');
            return JSON.parse(data);
        } catch (e) {
            console.error('[Erro] Falha ao carregar dados:', e);
            return {};
        }
    }

    async function saveProperties(data) {
        try {
            await GM.setValue(STORAGE_KEY, JSON.stringify(data));
            DEBUG_MODE && console.log('[Debug] Dados salvos com sucesso');
        } catch (e) {
            console.error('[Erro] Falha ao salvar dados:', e);
        }
    }

    function parsePrice(priceStr) {
        if (!priceStr) return 0;
        const num = priceStr.replace(/[^\d,]/g, '').replace(',', '');
        return parseInt(num) || 0;
    }

    function formatPrice(price) {
        return new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(price);
    }

    // ===== PROCESSAMENTO DE IMÓVEIS ===== //
    function extractPropertyData(item) {
        const linkEl = item.querySelector('a.item-link[href^="/imovel/"]');
        if (!linkEl) return null;

        const url = 'https://www.idealista.pt' + linkEl.getAttribute('href');
        const idMatch = url.match(/imovel\/(\d+)/);
        if (!idMatch) return null;

        const id = idMatch[1];
        const price = parsePrice(item.querySelector('.price-row .item-price')?.textContent);
        const typology = item.querySelector('.item-detail-char .item-detail')?.textContent?.match(/T\d+/)?.[0] || 'N/A';

        const areaEl = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
            .find(el => el.textContent.includes('m²'));
        const area = areaEl?.textContent?.match(/(\d+)\s*m²/)?.[0] || 'N/A';

        const hasGarage = item.querySelector('.price-row .item-parking') !== null;

        return { id, url, price, typology, area, hasGarage };
    }

    async function processProperties() {
        const items = Array.from(document.querySelectorAll('article.item'));
        if (items.length === 0) {
            DEBUG_MODE && console.log('[Debug] Nenhum imóvel encontrado na página');
            return null;
        }

        const allProperties = await loadProperties();
        let newCount = 0;
        let updatedCount = 0;

        for (const item of items) {
            const propData = extractPropertyData(item);
            if (!propData) continue;

            const existing = allProperties[propData.id] || {};
            const isNew = !existing.firstSeen;

            // Atualizar dados
            const updatedProp = {
                ...existing,
                ...propData,
                lastSeen: TODAY,
                history: existing.history || []
            };

            // Primeiro registro
            if (isNew) {
                updatedProp.firstSeen = TODAY;
                updatedProp.initialPrice = propData.price;
                newCount++;
            }

            // Registrar alteração de preço
            if (!isNew && existing.price !== undefined && existing.price !== propData.price) {
                updatedProp.history.push({
                    date: TODAY,
                    oldPrice: existing.price,
                    newPrice: propData.price,
                    change: propData.price - existing.price
                });
                updatedCount++;
            }

            allProperties[propData.id] = updatedProp;
        }

        await saveProperties(allProperties);
        DEBUG_MODE && console.log(`[Debug] Processados: ${items.length} imóveis | Novos: ${newCount} | Atualizados: ${updatedCount}`);

        return {
            allProperties,
            propertiesInPage: Object.values(allProperties)
                .filter(p => p.lastSeen === TODAY)
                .sort((a, b) => b.price - a.price)
        };
    }

    // ===== INTERFACE DO USUÁRIO ===== //
    GM_addStyle(`
        #idealistaTracker {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 820px;
            max-height: 90vh;
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: 'Segoe UI', Arial, sans-serif;
            display: flex;
            flex-direction: column;
        }
        #idealistaHeader {
            padding: 12px 15px;
            background: #34495e;
            color: white;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #idealistaTitle {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
        #idealistaClose {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
        }
        #idealistaContent {
            overflow-y: auto;
            padding: 10px;
            flex-grow: 1;
        }
        #idealistaTable {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        #idealistaTable th {
            position: sticky;
            top: 0;
            background: #2c3e50;
            color: white;
            padding: 8px 10px;
            text-align: left;
            font-weight: 500;
        }
        #idealistaTable td {
            padding: 8px 10px;
            border-bottom: 1px solid #ecf0f1;
            vertical-align: top;
        }
        #idealistaTable tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        .price-cell {
            font-weight: bold;
            white-space: nowrap;
        }
        .price-up {
            color: #e74c3c;
        }
        .price-down {
            color: #27ae60;
        }
        .price-same {
            color: #3498db;
        }
        .history-cell {
            font-size: 12px;
            line-height: 1.4;
            max-width: 200px;
        }
        .history-entry {
            display: flex;
            justify-content: space-between;
            margin-bottom: 2px;
        }
        .history-date {
            color: #7f8c8d;
        }
        #idealistaFooter {
            padding: 10px;
            background: #ecf0f1;
            border-radius: 0 0 8px 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #idealistaStats {
            font-size: 12px;
            color: #7f8c8d;
        }
        .idealistaButton {
            background: #2c3e50;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 5px;
        }
        .idealistaButton:hover {
            background: #1a252f;
        }
    `);

    function renderPriceChange(property) {
        if (!property.history || property.history.length === 0) {
            return `<span class="price-same">→ Estável</span>`;
        }

        const lastChange = property.history[property.history.length - 1];
        const change = lastChange.change;
        const absChange = Math.abs(change);
        const percent = Math.round((absChange / lastChange.oldPrice) * 100);

        if (change > 0) {
            return `<span class="price-up">↑ ${formatPrice(absChange)} (+${percent}%)</span>`;
        } else if (change < 0) {
            return `<span class="price-down">↓ ${formatPrice(absChange)} (-${percent}%)</span>`;
        }
        return `<span class="price-same">→ Igual</span>`;
    }

    function renderHistory(property) {
        if (!property.history || property.history.length === 0) {
            return `<div>Preço estável desde ${property.firstSeen}</div>`;
        }

        return property.history.slice().reverse().map(entry => `
            <div class="history-entry">
                <span class="history-date">${entry.date}</span>
                <span>${formatPrice(entry.oldPrice)} → ${formatPrice(entry.newPrice)}</span>
            </div>
        `).join('');
    }

    async function createTrackerUI() {
        const { allProperties, propertiesInPage } = await processProperties() || {};
        if (!propertiesInPage || propertiesInPage.length === 0) return;

        const totalProperties = Object.keys(allProperties).length;
        const newToday = propertiesInPage.filter(p => p.firstSeen === TODAY).length;

        const panel = document.createElement('div');
        panel.id = 'idealistaTracker';

        panel.innerHTML = `
            <div id="idealistaHeader">
                <h3 id="idealistaTitle">📈 Idealista Price Tracker</h3>
                <button id="idealistaClose" title="Fechar">✕</button>
            </div>
            <div id="idealistaContent">
                <table id="idealistaTable">
                    <thead>
                        <tr>
                            <th>Tipologia</th>
                            <th>Preço Atual</th>
                            <th>Variação</th>
                            <th>Histórico</th>
                            <th>Área</th>
                            <th>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${propertiesInPage.map(prop => `
                            <tr>
                                <td>${prop.typology}</td>
                                <td class="price-cell">${formatPrice(prop.price)}</td>
                                <td>${renderPriceChange(prop)}</td>
                                <td class="history-cell">${renderHistory(prop)}</td>
                                <td>${prop.area}</td>
                                <td><a href="${prop.url}" target="_blank">${prop.id}</a></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div id="idealistaFooter">
                <div id="idealistaStats">
                    ${propertiesInPage.length} nesta página |
                    ${newToday} novos hoje |
                    ${totalProperties} no total
                </div>
                <div>
                    <button id="idealistaExport" class="idealistaButton">📁 Exportar Tudo</button>
                    <button id="idealistaClear" class="idealistaButton">🗑️ Limpar Dados</button>
                </div>
            </div>
        `;

        // Event Listeners
        panel.querySelector('#idealistaClose').addEventListener('click', () => panel.remove());

        panel.querySelector('#idealistaExport').addEventListener('click', async () => {
            const data = await loadProperties();
            const csvContent = Object.values(data).map(prop => {
                return [
                    prop.id,
                    prop.typology,
                    prop.initialPrice,
                    prop.price,
                    prop.firstSeen,
                    prop.lastSeen,
                    prop.area,
                    prop.hasGarage ? 'Sim' : 'Não',
                    prop.history?.length || 0,
                    prop.url,
                    prop.history?.map(h => `${h.date}:${h.oldPrice}>${h.newPrice}`).join('|') || ''
                ].join(';');
            }).join('\n');

            const csvHeader = [
                'ID', 'Tipologia', 'Preço Inicial', 'Preço Atual',
                'Primeira Visita', 'Última Visita', 'Área', 'Garagem',
                'Mudanças', 'URL', 'Histórico'
            ].join(';');

            GM_setClipboard(`${csvHeader}\n${csvContent}`, 'text');
            alert(`Dados de ${totalProperties} imóveis copiados!`);
        });

        panel.querySelector('#idealistaClear').addEventListener('click', async () => {
            if (confirm('ATENÇÃO: Isso apagará TODOS os dados armazenados. Continuar?')) {
                await GM.setValue(STORAGE_KEY, '{}');
                alert('Todos os dados foram removidos!');
                panel.remove();
            }
        });

        document.body.appendChild(panel);
    }

    // ===== INICIALIZAÇÃO ===== //
    async function initializeTracker() {
        // Verificação inicial
        if (document.querySelector('article.item')) {
            await createTrackerUI();
            return;
        }

        // Observer para conteúdo dinâmico
        const observer = new MutationObserver(async mutations => {
            if (document.querySelector('article.item')) {
                observer.disconnect();
                await createTrackerUI();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });

        // Timeout de segurança
        setTimeout(() => observer.disconnect(), 15000);
    }

    // Aguardar carregamento da página
    if (document.readyState === 'complete') {
        setTimeout(initializeTracker, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(initializeTracker, 1000));
    }
})();