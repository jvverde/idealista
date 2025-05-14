// ==UserScript==
// @name         Idealista Tracker Ultimate
// @namespace    http://tampermonkey.net/
// @version      7.2
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

(function() {
    'use strict';

    // ===== VERIFICAÇÃO DE URL ===== //
    function isIdealistaListingPage() {
        const allowedPaths = [
            /\/comprar-.+\//,
            /\/arrendar-.+\//
        ];
        const forbiddenPaths = [
            /\/imovel\//,
            /\/blog\//,
            /\/ajuda\//,
            /\/contato\//,
            /\/mapa$/
        ];

        const currentPath = window.location.pathname.toLowerCase();
        return (
            allowedPaths.some(regex => regex.test(currentPath)) &&
            !forbiddenPaths.some(regex => regex.test(currentPath))
        );
    }


    if (!isIdealistaListingPage()) {
        console.log('[Idealista Extractor] Não é página de listagem');
        return;
    }

    const DateTime = luxon.DateTime;
    console.log('[Idealista Tracker] Iniciando...');

    // ===== CONFIGURAÇÕES ===== //
    const STORAGE_PREFIX = 'idealista_tracker_v7_';
    const NOW = DateTime.now().toISO();

    // ===== DETECÇÃO DE CONTEXTO ===== //
    function getPageContext() {
        const url = new URL(window.location.href);
        const pathParts = url.pathname.toLowerCase().split('/').filter(Boolean);
        
        // Se for pesquisa por área (com shape)
        if (url.searchParams.has('shape')) {
            return {
                isAreaSearch: true,
                transactionType: pathParts[0].includes('arrendar') ? 'rent' : 'sale',
                propertyType: pathParts[0].includes('casas') ? 'houses' : 
                             pathParts[0].includes('apartamentos') ? 'apartments' : 'other',
                location: '',
                subLocation: ''
            };
        }

        // Detecção normal
        let transactionType = '';
        let propertyType = 'other';
        let location = '';
        let subLocation = '';

        if (pathParts.length >= 2 && pathParts[0].includes('-')) {
            const [trans, type] = pathParts[0].split('-');
            transactionType = trans;
            propertyType = type;
            location = pathParts[1] || '';
            subLocation = pathParts[2] || '';
        } else if (pathParts[0] === 'geo' && pathParts.length >= 3) {
            const [trans, type] = pathParts[1].split('-');
            transactionType = trans;
            propertyType = type;
            location = pathParts[2] || '';
        }

        return {
            isAreaSearch: false,
            transactionType: { 'arrendar': 'rent', 'comprar': 'sale', 'venda': 'sale' }[transactionType] || '',
            propertyType: { 
                'casas': 'houses', 'apartamentos': 'apartments', 'quartos': 'rooms',
                'escritorios': 'offices', 'garagens': 'parking', 'terrenos': 'lands'
            }[propertyType] || 'other',
            location: location,
            subLocation: subLocation
        };
    }

    // ===== SISTEMA DE ARMAZENAMENTO ===== //
    function getStorageKey(context) {
        if (context.isAreaSearch) {
            return `${STORAGE_PREFIX}area_${context.transactionType}_${context.propertyType}`;
        }
        return `${STORAGE_PREFIX}${context.transactionType}_${context.propertyType}_${context.location}_${context.subLocation}`.replace(/_+$/, '');
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

    // ===== ATUALIZAÇÃO DE STATUS ===== //
    async function updatePropertyStatus(propertyId, isCurrentlyListed) {
        try {
            const allKeys = await GM.listValues();
            const trackerKeys = allKeys.filter(key => key.startsWith(STORAGE_PREFIX));
            
            for (const key of trackerKeys) {
                const data = await GM.getValue(key, '{}');
                const parsedData = JSON.parse(data);
                
                if (parsedData[propertyId]) {
                    parsedData[propertyId].lastSeen = NOW;
                    parsedData[propertyId].isActive = isCurrentlyListed;
                    await GM.setValue(key, JSON.stringify(parsedData));
                }
            }
        } catch (e) {
            console.error('Erro ao atualizar status:', e);
        }
    }

    // ===== PROCESSAMENTO DE IMÓVEIS ===== //
    function extractPropertyInfo(item) {
        const linkEl = item.querySelector('a.item-link[href^="/imovel/"]');
        if (!linkEl) return null;

        const url = 'https://www.idealista.pt' + linkEl.getAttribute('href');
        const idMatch = url.match(/imovel\/(\d+)/);
        if (!idMatch) return null;

        // Edge-compatible price extraction
        const priceElement = item.querySelector('.price-row .item-price');
        const priceText = priceElement ? priceElement.textContent : '';
        const price = parseInt(priceText.replace(/\D+/g, '')) || 0;

        // Edge-compatible typology extraction
        const typologyElement = item.querySelector('.item-detail-char .item-detail');
        const typologyText = typologyElement ? typologyElement.textContent : '';
        const typologyMatch = typologyText.match(/(T\d+|Quarto|Estúdio)/i);
        const typology = typologyMatch ? typologyMatch[0] : 'N/A';

        // Edge-compatible area extraction
        const areaElements = Array.from(item.querySelectorAll('.item-detail-char .item-detail'));
        const areaElement = areaElements.find(function(el) {
            return el.textContent.includes('m²');
        });
        const areaText = areaElement ? areaElement.textContent : '';
        const areaMatch = areaText.match(/(\d+)\s*m²/);
        const area = areaMatch ? areaMatch[0] : 'N/A';

        // Edge-compatible garage detection
        const hasGarage = item.querySelector('.item-parking, [title*="garagem"]') !== null;

        return {
            id: idMatch[1],
            url: url,
            price: price,
            typology: typology,
            area: area,
            hasGarage: hasGarage,
            isActive: true
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
        .idealista-button {
            background: #2c3e50;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 5px;
            transition: background 0.2s;
        }
        .idealista-button:hover {
            background: #1a252f;
        }
        .idealista-button.danger {
            background: #e74c3c;
        }
        .idealista-button.danger:hover {
            background: #c0392b;
        }
        .context-badge {
            background: #9b59b6;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 8px;
        }
        a {
            color: #2980b9;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .date-cell {
            font-size: 12px;
            white-space: nowrap;
        }
        .status-inactive {
            color: #e74c3c;
            font-weight: bold;
        }
        .status-active {
            color: #27ae60;
        }
        .status-active-row {
            background-color: #e8f5e9 !important; /* Light green for active */
        }
        .status-inactive-row {
            background-color: #ffebee !important; /* Light red for inactive */
        }
        /* Remove the old status text styles */
        .status-inactive, .status-active {
            display: none;
        }
    `);

    async function createUI() {
        const context = getPageContext();
        if (!context.transactionType) return;

        const currentItems = Array.from(document.querySelectorAll('article.item'));
        const currentIds = currentItems.map(item => {
            const link = item.querySelector('a.item-link[href^="/imovel/"]');
            return link ? link.getAttribute('href').match(/imovel\/(\d+)/)?.[1] : null;
        }).filter(Boolean);

        const allData = await loadData(context);
        let newCount = 0;

        // Atualizar dados dos imóveis atuais
        for (const item of currentItems) {
            const propInfo = extractPropertyInfo(item);
            if (!propInfo) continue;

            const isNew = !allData[propInfo.id];
            if (isNew) {
                propInfo.firstSeen = NOW;
                propInfo.initialPrice = propInfo.price;
                if (!context.isAreaSearch) {
                    propInfo.location = context.location;
                    propInfo.subLocation = context.subLocation;
                }
                newCount++;
            }

            allData[propInfo.id] = {
                ...(allData[propInfo.id] || {}),
                ...propInfo,
                lastSeen: NOW,
                isActive: true
            };
        }

        // Marcar imóveis não listados (apenas para pesquisas por localidade)
        if (!context.isAreaSearch) {
            for (const propId of Object.keys(allData)) {
                if (!currentIds.includes(propId)) {
                    allData[propId].isActive = false;
                    await updatePropertyStatus(propId, false);
                }
            }
        }

        await saveData(context, allData);

        // Preparar dados para exibição
        const displayData = Object.values(allData)
            .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

        // Criar painel
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
                            <th>Tipo</th>
                            <th>Preço</th>
                            <th>Variação</th>
                            <th>Área</th>
                            <th>1ª Detecção</th>
                            <th>Últ. Atualização</th>
                            <th>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayData.map(prop => `
                            <tr class="${prop.isActive ? 'status-active-row' : 'status-inactive-row'}">
                                <td>${prop.typology}</td>
                                <td class="price-cell">${formatPrice(prop.price)}</td>
                                <td>${renderPriceTrend(prop)}</td>
                                <td>${prop.area}</td>
                                <td class="date-cell">${formatDisplayDate(prop.firstSeen)}</td>
                                <td class="date-cell">${formatDisplayDate(prop.lastSeen)}</td>
                                <td><a href="${prop.url}" target="_blank">${prop.id}</a></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div id="idealistaFooter">
                <div id="idealistaStats">
                    ${currentItems.length} ativos | 
                    ${displayData.length} totais | 
                    ${newCount} novos
                </div>
                <div>
                    <button id="idealistaExport" class="idealista-button">📁 Exportar</button>
                    <button id="idealistaClear" class="idealista-button danger">🗑️ Limpar Tudo</button>
                </div>
            </div>
        `;

        // Configurar eventos
        panel.querySelector('#idealistaClose').addEventListener('click', () => panel.remove());
        
        panel.querySelector('#idealistaExport').addEventListener('click', async () => {
            const csvContent = displayData.map(p => [
                p.id, p.typology, p.initialPrice, p.price, 
                p.firstSeen, p.lastSeen, p.isActive ? 'Ativo' : 'Inativo',
                p.area, p.hasGarage ? 'Sim' : 'Não',
                p.location || '', p.subLocation || '',
                p.history?.length || 0, p.url
            ].join(';')).join('\n');
            
            const csvHeader = [
                'ID', 'Tipologia', 'Preço Inicial', 'Preço Atual',
                'Primeira Detecção', 'Última Atualização', 'Status',
                'Área', 'Garagem', 'Localidade', 'Sub-localidade',
                'Mudanças', 'URL'
            ].join(';');
            
            GM_setClipboard(`${csvHeader}\n${csvContent}`, 'text');
            alert(`Dados exportados para ${displayData.length} imóveis!`);
        });

        panel.querySelector('#idealistaClear').addEventListener('click', async () => {
            if (confirm('⚠️ ATENÇÃO: Isso apagará TODOS os dados armazenados. Continuar?')) {
                const success = await clearAllData();
                if (success) {
                    alert('Todos os dados foram removidos!');
                    panel.remove();
                } else {
                    alert('Ocorreu um erro ao limpar os dados.');
                }
            }
        });

        document.body.appendChild(panel);
    }

    // ===== FUNÇÕES AUXILIARES ===== //
    function formatPrice(price) {
        return new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(price);
    }

    function formatDisplayDate(isoDate) {
        if (!isoDate) return 'N/A';
        return DateTime.fromISO(isoDate).toFormat('yyyy-MM-dd HH:mm');
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
            'houses': 'Casas', 'apartments': 'Apartamentos', 'rooms': 'Quartos',
            'offices': 'Escritórios', 'parking': 'Garagens', 'lands': 'Terrenos'
        };
        
        let locationText = context.isAreaSearch ? ' (Área)' : '';
        if (context.location) {
            locationText = ` em ${context.location.replace(/-/g, ' ')}`;
            if (context.subLocation) locationText += ` > ${context.subLocation.replace(/-/g, ' ')}`;
        }
        
        return `${transactions[context.transactionType]} ${properties[context.propertyType]}${locationText}`;
    }

    async function clearAllData() {
        try {
            const allKeys = await GM.listValues();
            const trackerKeys = allKeys.filter(key => key.startsWith(STORAGE_PREFIX));
            for (const key of trackerKeys) await GM.deleteValue(key);
            return true;
        } catch (e) {
            console.error('Erro ao limpar dados:', e);
            return false;
        }
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