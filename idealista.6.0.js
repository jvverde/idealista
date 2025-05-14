// ==UserScript==
// @name         Idealista Tracker Segmentado
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Rastreamento separado por tipo de transação e propriedade
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
    console.log('[Idealista Tracker] Iniciando...');

    // ===== CONFIGURAÇÕES ===== //
    const STORAGE_PREFIX = 'idealista_tracker_';
    const TODAY = DateTime.now().toFormat('dd/MM/yyyy');

    // ===== DETECÇÃO DE CONTEXTO ===== //
    function getPageContext() {
        const path = window.location.pathname.toLowerCase();
        
        // Determinar tipo de transação
        let transactionType = '';
        if (path.includes('/arrendar-')) transactionType = 'rent';
        else if (path.includes('/venda-') || path.includes('/comprar-')) transactionType = 'sale';
        
        // Determinar tipo de propriedade
        let propertyType = '';
        if (path.includes('-casas') || path.includes('/casas/')) propertyType = 'houses';
        else if (path.includes('-apartamentos') || path.includes('/apartamentos/')) propertyType = 'apartments';
        else if (path.includes('-escritorios') || path.includes('/escritorios/')) propertyType = 'offices';
        else if (path.includes('-moradias')) propertyType = 'villages';
        
        return { transactionType, propertyType };
    }

    // ===== SISTEMA DE ARMAZENAMENTO ===== //
    function getStorageKey(context) {
        return `${STORAGE_PREFIX}${context.transactionType}_${context.propertyType}`;
    }

    async function loadData(context) {
        try {
            const data = await GM.getValue(getStorageKey(context), '{}');
            return JSON.parse(data);
        } catch (e) {
            console.error('Erro ao carregar dados:', e);
            return {};
        }
    }

    async function saveData(context, data) {
        try {
            await GM.setValue(getStorageKey(context), JSON.stringify(data));
        } catch (e) {
            console.error('Erro ao salvar dados:', e);
        }
    }

    // ===== PROCESSAMENTO DE IMÓVEIS ===== //
    function extractPropertyInfo(item) {
        const linkEl = item.querySelector('a.item-link[href^="/imovel/"]');
        if (!linkEl) return null;

        const url = 'https://www.idealista.pt' + linkEl.getAttribute('href');
        const idMatch = url.match(/imovel\/(\d+)/);
        if (!idMatch) return null;

        const priceText = item.querySelector('.price-row .item-price')?.textContent || '';
        const price = parseInt(priceText.replace(/\D+/g, '')) || 0;

        return {
            id: idMatch[1],
            url,
            price,
            typology: item.querySelector('.item-detail-char .item-detail')?.textContent?.match(/T\d+/)?.[0] || 'N/A',
            area: Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
                .find(el => el.textContent.includes('m²'))?.textContent?.match(/(\d+)\s*m²/)?.[0] || 'N/A',
            hasGarage: item.querySelector('.price-row .item-parking') !== null
        };
    }

    async function processProperties(context) {
        const items = Array.from(document.querySelectorAll('article.item'));
        if (items.length === 0) return null;

        const allData = await loadData(context);
        let newCount = 0, updatedCount = 0;

        for (const item of items) {
            const propInfo = extractPropertyInfo(item);
            if (!propInfo) continue;

            const existing = allData[propInfo.id] || {};
            const isNew = !existing.firstSeen;

            // Atualizar dados
            const updatedProp = {
                ...existing,
                ...propInfo,
                lastSeen: TODAY,
                history: existing.history || []
            };

            if (isNew) {
                updatedProp.firstSeen = TODAY;
                updatedProp.initialPrice = propInfo.price;
                newCount++;
            } else if (existing.price !== propInfo.price) {
                updatedProp.history.push({
                    date: TODAY,
                    oldPrice: existing.price,
                    newPrice: propInfo.price,
                    change: propInfo.price - existing.price
                });
                updatedCount++;
            }

            allData[propInfo.id] = updatedProp;
        }

        await saveData(context, allData);
        console.log(`Processados: ${items.length} imóveis | Novos: ${newCount} | Atualizados: ${updatedCount}`);

        return {
            allData,
            currentData: Object.values(allData).filter(p => p.lastSeen === TODAY)
        };
    }

    // ===== INTERFACE DO USUÁRIO ===== //
    GM_addStyle(`
        #idealistaPanel {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 850px;
            max-height: 90vh;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 2px 15px rgba(0,0,0,0.1);
            z-index: 10000;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
        }
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
        .context-badge {
            background: #3498db;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 8px;
        }
    `);

    function formatPrice(price) {
        return new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(price);
    }

    function renderPriceTrend(property) {
        if (!property.history?.length) return '<span class="price-same">→ Estável</span>';
        
        const last = property.history[property.history.length - 1];
        const diff = last.change;
        const absDiff = Math.abs(diff);
        const pct = Math.round((absDiff / last.oldPrice) * 100);
        
        if (diff > 0) return `<span class="price-up">↑ +${formatPrice(absDiff)} (+${pct}%)</span>`;
        if (diff < 0) return `<span class="price-down">↓ -${formatPrice(absDiff)} (-${pct}%)</span>`;
        return '<span class="price-same">→ Igual</span>';
    }

    function translateContext(context) {
        const transactions = { 'rent': 'Arrendar', 'sale': 'Comprar' };
        const properties = {
            'houses': 'Casas',
            'apartments': 'Apartamentos',
            'offices': 'Escritórios',
            'villages': 'Moradias'
        };
        return `${transactions[context.transactionType]} ${properties[context.propertyType]}`;
    }

    async function createUI() {
        const context = getPageContext();
        if (!context.transactionType || !context.propertyType) {
            console.log('Contexto não suportado');
            return;
        }

        const { allData, currentData } = await processProperties(context) || {};
        if (!currentData || currentData.length === 0) return;

        const panel = document.createElement('div');
        panel.id = 'idealistaPanel';
        
        panel.innerHTML = `
            <div id="idealistaHeader">
                <h3 id="idealistaTitle">
                    📊 Idealista Tracker
                    <span class="context-badge">${translateContext(context)}</span>
                </h3>
                <button id="idealistaClose">✕</button>
            </div>
            <div id="idealistaContent">
                <table id="idealistaTable">
                    <thead>
                        <tr>
                            <th>Tipologia</th>
                            <th>Preço</th>
                            <th>Variação</th>
                            <th>Área</th>
                            <th>Garagem</th>
                            <th>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${currentData.sort((a, b) => b.price - a.price).map(prop => `
                            <tr>
                                <td>${prop.typology}</td>
                                <td class="price-cell">${formatPrice(prop.price)}</td>
                                <td>${renderPriceTrend(prop)}</td>
                                <td>${prop.area}</td>
                                <td>${prop.hasGarage ? 'Sim' : 'Não'}</td>
                                <td><a href="${prop.url}" target="_blank">${prop.id}</a></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div id="idealistaFooter">
                <div id="idealistaStats">
                    ${currentData.length} imóveis nesta página | 
                    ${Object.keys(allData).length} no total
                </div>
                <button id="idealistaExport">📁 Exportar Dados</button>
            </div>
        `;

        panel.querySelector('#idealistaClose').addEventListener('click', () => panel.remove());
        panel.querySelector('#idealistaExport').addEventListener('click', async () => {
            const csvContent = Object.values(allData).map(p => [
                p.id, p.typology, p.initialPrice, p.price, 
                p.firstSeen, p.lastSeen, p.area, 
                p.hasGarage ? 'Sim' : 'Não', p.history?.length || 0, p.url
            ].join(';')).join('\n');
            
            GM_setClipboard(csvContent, 'text');
            alert(`Dados exportados para ${Object.keys(allData).length} imóveis!`);
        });

        document.body.appendChild(panel);
    }

    // ===== INICIALIZAÇÃO ===== //
    async function init() {
        if (document.querySelector('article.item')) {
            await createUI();
            return;
        }

        const observer = new MutationObserver(() => {
            if (document.querySelector('article.item')) {
                observer.disconnect();
                createUI();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 500));
    }
})();