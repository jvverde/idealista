// ==UserScript==
// @name         Idealista Tracker Universal
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  Rastreamento completo para todos os tipos de imóveis e transações
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

    // ===== DETECÇÃO DE CONTEXTO COMPLETA ===== //
    function getPageContext() {
        const path = window.location.pathname.toLowerCase();
        
        // Tipo de transação
        let transactionType = '';
        if (path.includes('/arrendar')) transactionType = 'rent';
        else if (path.includes('/venda') || path.includes('/comprar')) transactionType = 'sale';
        
        // Tipo de propriedade (com todas as variações)
        let propertyType = 'other';
        const propertyTypes = {
            'casas': 'houses',
            'apartamentos': 'apartments',
            'moradias': 'villages',
            'escritorios': 'offices',
            'lojas': 'stores',
            'quintas': 'farms',
            'terrenos': 'lands',
            'garagens': 'parking',
            'quartos': 'rooms',
            'estudios': 'studios'
        };
        
        for (const [ptKey, enKey] of Object.entries(propertyTypes)) {
            if (path.includes(ptKey) || path.includes(`-${ptKey.replace('os', 'o')}`)) {
                propertyType = enKey;
                break;
            }
        }
        
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

        // Extrair preço (compatível com diferentes formatos)
        const priceText = item.querySelector('.price-row .item-price')?.textContent || '';
        const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;

        // Extrair tipologia (T0-T9, Quarto, Estúdio, etc.)
        let typology = item.querySelector('.item-detail-char .item-detail:first-child')?.textContent || '';
        typology = typology.match(/(T\d+|Quarto|Estúdio|Studio|Casa)/i)?.[0] || 'N/A';

        // Extrair área (compatível com diferentes formatos)
        const areaText = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
            .find(el => el.textContent.match(/m²|metro|quadrado/i))?.textContent || '';
        const area = areaText.match(/(\d+[\.,]?\d*)\s*(m²|metros?|mq)/i)?.[1] + ' m²' || 'N/A';

        // Verificar garagem (compatível com diferentes anúncios)
        const hasGarage = item.querySelector('.item-parking, [title*="garagem"], [title*="estacionamento"]') !== null;

        return {
            id: idMatch[1],
            url,
            price,
            typology,
            area,
            hasGarage
        };
    }

    // ===== INTERFACE DO USUÁRIO ===== //
    GM_addStyle(`
        /* ... (manter estilos anteriores) ... */
        .property-badge {
            background: #9b59b6;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 5px;
        }
    `);

    function translateContext(context) {
        const transactionMap = {
            'rent': 'Arrendar',
            'sale': 'Comprar'
        };
        
        const propertyMap = {
            'houses': 'Casas',
            'apartments': 'Apartamentos',
            'villages': 'Moradias',
            'offices': 'Escritórios',
            'stores': 'Lojas',
            'farms': 'Quintas',
            'lands': 'Terrenos',
            'parking': 'Garagens',
            'rooms': 'Quartos',
            'studios': 'Estúdios',
            'other': 'Outros'
        };
        
        return `${transactionMap[context.transactionType]} ${propertyMap[context.propertyType]}`;
    }

    async function createUI() {
        const context = getPageContext();
        if (!context.transactionType) {
            console.log('Página não suportada');
            return;
        }

        const allData = await loadData(context);
        const items = Array.from(document.querySelectorAll('article.item'));
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
            } else if (existing.price !== undefined && existing.price !== propInfo.price) {
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

        // Filtrar apenas imóveis vistos hoje
        const todayProperties = Object.values(allData)
            .filter(p => p.lastSeen === TODAY)
            .sort((a, b) => b.price - a.price);

        if (todayProperties.length === 0) return;

        // Criar painel
        const panel = document.createElement('div');
        panel.id = 'idealistaPanel';
        panel.innerHTML = `
            <div id="idealistaHeader">
                <h3 id="idealistaTitle">
                    📊 Idealista Tracker
                    <span class="property-badge">${translateContext(context)}</span>
                </h3>
                <button id="idealistaClose">✕</button>
            </div>
            <div id="idealistaContent">
                <table id="idealistaTable">
                    <thead>
                        <tr>
                            <th>Tipo</th>
                            <th>Preço</th>
                            <th>Variação</th>
                            <th>Área</th>
                            <th>Garagem</th>
                            <th>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${todayProperties.map(prop => `
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
                    ${todayProperties.length} imóveis | 
                    ${Object.keys(allData).length} no total | 
                    ${newCount} novos
                </div>
                <button id="idealistaExport">📁 Exportar Dados</button>
            </div>
        `;

        // Event listeners
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

    // Funções auxiliares
    function formatPrice(price) {
        return new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
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
        setTimeout(init, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1000));
    }
})();