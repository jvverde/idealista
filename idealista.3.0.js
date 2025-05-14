// ==UserScript==
// @name         Idealista Extractor Premium
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Extrai preço, tipologia, área, garagem e links do Idealista.pt
// @author       Você
// @match        https://www.idealista.pt/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    console.log('[Idealista Extractor] Iniciando...');

    // ===== VERIFICAÇÃO DE URL ===== //
    function isIdealistaListingPage() {
        const currentUrl = window.location.href.toLowerCase();
        const currentPath = window.location.pathname.toLowerCase();

        // URLs bloqueadas
        const blockedPaths = [
            '/imovel/',
            '/blog/',
            '/ajuda/',
            '/contato/',
            '/perfil/',
            '/mensagens/',
            '/favoritos/',
            '/anunciar/',
            '/login/',
            '/registro/'
        ];

        if (blockedPaths.some(path => currentPath.includes(path))) {
            console.log('[Idealista Extractor] URL bloqueada');
            return false;
        }

        // Padrões de URLs de listagem
        const listingPatterns = [
            /\/arrendar\-casas\//,
            /\/venda\-casas\//,
            /\/comprar\-casas\//,
            /\/pesquisar\-casas\//,
            /\/areas\/arrendar\-casas\//,
            /\/areas\/venda\-casas\//,
            /\/arrendar\-apartamentos\//,
            /\/venda\-apartamentos\//,
            /\/arrendar\-moradias\//,
            /\/venda\-moradias\//,
            /\/(casas|apartamentos|moradias)\/[a-z\-]+\/[a-z\-]+(\/|$)/,
            /\/\?shape=\(\(.*\)\)/
        ];

        return listingPatterns.some(pattern => pattern.test(currentPath));
    }

    if (!isIdealistaListingPage()) {
        console.log('[Idealista Extractor] Não é página de listagem');
        return;
    }

    // ===== ESTILOS ===== //
    GM_addStyle(`
        #idealistaDataPanel {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 720px;
            max-height: 85vh;
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 99999;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
        }
        #idealistaDataHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background: #f8f8f8;
            border-bottom: 1px solid #e0e0e0;
            border-radius: 8px 8px 0 0;
        }
        #idealistaDataTitle {
            margin: 0;
            color: #2c3e50;
            font-size: 15px;
            font-weight: 600;
        }
        #idealistaDismissBtn {
            background: #e74c3c;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 3px 10px;
            cursor: pointer;
            font-weight: bold;
        }
        #idealistaDataContent {
            overflow-y: auto;
            padding: 0 5px;
        }
        #idealistaDataTable {
            width: 100%;
            border-collapse: collapse;
            margin: 5px 0;
        }
        #idealistaDataTable th {
            position: sticky;
            top: 0;
            background: #34495e;
            color: white;
            padding: 8px 10px;
            text-align: left;
            font-weight: 500;
        }
        #idealistaDataTable td {
            padding: 8px 10px;
            border-bottom: 1px solid #ecf0f1;
            vertical-align: top;
        }
        #idealistaDataTable tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        #idealistaDataTable a {
            color: #2980b9;
            text-decoration: none;
            word-break: break-all;
        }
        #idealistaDataTable a:hover {
            text-decoration: underline;
            color: #e74c3c;
        }
        #idealistaCopyCSV {
            padding: 10px;
            background: #2c3e50;
            color: white;
            border: none;
            border-radius: 0 0 8px 8px;
            cursor: pointer;
            font-weight: bold;
            transition: background 0.2s;
        }
        #idealistaCopyCSV:hover {
            background: #1a252f;
        }
        .nowrap {
            white-space: nowrap;
        }
        .center {
            text-align: center;
        }
        .price-cell {
            font-weight: bold;
            color: #27ae60;
        }
    `);

    // ===== EXTRAÇÃO DE DADOS ===== //
    function extractPropertyData() {
        const baseUrl = 'https://www.idealista.pt';
        const items = document.querySelectorAll('article.item');

        return Array.from(items).map(item => {
            // Link
            const linkElement = item.querySelector('a.item-link[href^="/imovel/"]');
            const link = linkElement ? baseUrl + linkElement.getAttribute('href') : '';

            // Preço
            const priceElement = item.querySelector('.price-row .item-price');
            const price = priceElement ? priceElement.textContent.replace(/\s+/g, ' ').trim() : 'N/A';

            // Tipologia (T1, T2, etc.)
            const tipologiaElement = item.querySelector('.item-detail-char .item-detail:first-child');
            let tipologia = 'N/A';
            if (tipologiaElement) {
                const match = tipologiaElement.textContent.match(/T\d+/);
                tipologia = match ? match[0] : tipologiaElement.textContent.trim().split(' ')[0];
            }

            // Área Bruta
            const areaElement = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
                .find(el => el.textContent.includes('m²'));
            const area = areaElement ? areaElement.textContent.match(/(\d+[\.,]?\d*)\s*m²/)?.[0] : 'N/A';

            // Garagem
            const hasGarage = item.querySelector('.price-row .item-parking') !== null;
            const garage = hasGarage ? 'Sim' : 'Não';

            return { link, price, tipologia, area, garage };
        }).filter(property => property.link && property.link.includes('/imovel/'));
    }

    // ===== CRIAÇÃO DO PAINEL ===== //
    function createDataPanel(data) {
        const panel = document.createElement('div');
        panel.id = 'idealistaDataPanel';

        // Cabeçalho
        panel.innerHTML = `
            <div id="idealistaDataHeader">
                <h3 id="idealistaDataTitle">🏠 ${data.length} Imóveis Encontrados</h3>
                <button id="idealistaDismissBtn" title="Fechar painel">✕</button>
            </div>
            <div id="idealistaDataContent">
                <table id="idealistaDataTable">
                    <thead>
                        <tr>
                            <th>Preço</th>
                            <th>Tipologia</th>
                            <th>Área</th>
                            <th class="center">Garagem</th>
                            <th>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(property => `
                            <tr>
                                <td class="nowrap price-cell">${property.price}</td>
                                <td class="nowrap">${property.tipologia}</td>
                                <td class="nowrap">${property.area}</td>
                                <td class="center">${property.garage}</td>
                                <td><a href="${property.link}" target="_blank">${property.link.replace('https://www.idealista.pt', '')}</a></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <button id="idealistaCopyCSV" title="Copiar todos os dados para área de transferência">📋 Copiar como CSV</button>
        `;

        // Event Listeners
        panel.querySelector('#idealistaDismissBtn').addEventListener('click', () => {
            panel.remove();
        });

        panel.querySelector('#idealistaCopyCSV').addEventListener('click', () => {
            const headers = ['Preço', 'Tipologia', 'Área', 'Garagem', 'Link'];
            const csvContent = [
                headers.join(','),
                ...data.map(item => headers.map(header => {
                    const value = item[header.toLowerCase()];
                    return `"${value.toString().replace(/"/g, '""')}"`;
                }).join(','))
            ].join('\n');

            GM_setClipboard(csvContent, 'text');
            const button = panel.querySelector('#idealistaCopyCSV');
            button.textContent = '✓ Copiado!';
            setTimeout(() => {
                button.textContent = '📋 Copiar como CSV';
            }, 2000);
        });

        document.body.appendChild(panel);
    }

    // ===== DETECÇÃO DE ANÚNCIOS ===== //
    function checkForListings() {
        const items = document.querySelectorAll('article.item');
        if (items.length > 0) {
            console.log(`[Idealista Extractor] ${items.length} anúncios detectados`);
            const propertyData = extractPropertyData();
            if (propertyData.length > 0) {
                createDataPanel(propertyData);
                return true;
            }
        }
        return false;
    }

    // ===== INICIALIZAÇÃO ===== //
    function init() {
        // Tentativa inicial
        if (checkForListings()) return;

        // Observer para conteúdo dinâmico
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    if (checkForListings()) {
                        observer.disconnect();
                        break;
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Fallback após 10 segundos
        setTimeout(() => {
            observer.disconnect();
            checkForListings();
        }, 10000);
    }

    // Aguardar o carregamento da página
    if (document.readyState === 'complete') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 500));
    }
})();