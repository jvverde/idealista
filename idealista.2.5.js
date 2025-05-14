// ==UserScript==
// @name         Idealista Extractor Definitivo
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Extrai preço, tipologia, área bruta, garagem e links com 100% de precisão
// @author       Você
// @match        https://www.idealista.pt/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';
    console.log('Idealista userscript init...');

    // ===== VERIFICAÇÃO DE URL ===== //
    function isIdealistaListingPage() {
        const allowedPaths = [
            /\/areas\/arrendar-casas\//,
            /\/venda\//,
            /\/arrendar\//,
            /\/pesquisar\//,
            /\/comprar\//,
            /\/arrendar-casas\//
        ];
        const forbiddenPaths = [
            /\/imovel\//,
            /\/blog\//,
            /\/ajuda\//,
            /\/contato\//
        ];

        const currentPath = window.location.pathname;
        return (
            allowedPaths.some(regex => regex.test(currentPath)) &&
            !forbiddenPaths.some(regex => regex.test(currentPath))
        );
    }

    if (!isIdealistaListingPage()) return;
    console.log('Idealista go for it...');

    // ===== ESTILOS ===== //
    GM_addStyle(`
        #idealistaDataPanel {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 700px;
            max-height: 85vh;
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
        }
        #idealistaDataHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background: #f8f8f8;
            border-bottom: 1px solid #e0e0e0;
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
        #idealistaDataTable {
            width: 100%;
            border-collapse: collapse;
        }
        #idealistaDataTable th {
            position: sticky;
            top: 0;
            background: #34495e;
            color: white;
            padding: 8px 10px;
            text-align: left;
        }
        #idealistaDataTable td {
            padding: 8px 10px;
            border-bottom: 1px solid #ecf0f1;
        }
        #idealistaDataTable tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        #idealistaDataTable a {
            color: #2980b9;
            text-decoration: none;
            display: inline-block;
            max-width: 120px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #idealistaDataTable a:hover {
            text-decoration: underline;
            color: #e74c3c;
        }
        #idealistaCopyCSV {
            display: block;
            margin: 0;
            padding: 10px;
            width: 100%;
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
        .nowrap { white-space: nowrap; }
        .center { text-align: center; }
    `);

    // ===== EXTRAÇÃO DE DADOS ===== //
    function extractPropertyData() {
        const baseUrl = 'https://www.idealista.pt';
        const items = document.querySelectorAll('article.item');

        return Array.from(items).map(item => {
            // Link
            const link = baseUrl + (item.querySelector('a.item-link')?.getAttribute('href') || '');

            // Preço
            const price = item.querySelector('.price-row .item-price')?.textContent?.replace(/\s+/g, ' ').trim() || 'N/A';

            // Tipologia (T1, T2, etc.)
            const tipologia = item.querySelector('.item-detail-char .item-detail')?.textContent?.match(/T\d+/)?.[0] || 'N/A';

            // Área Bruta
            const areaElement = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
                .find(el => el.textContent.includes('m²'));
            const area = areaElement?.textContent?.match(/(\d+)\s*m²/)?.[0] || 'N/A';

            // Garagem (CORREÇÃO PRINCIPAL)
            const hasGarage = item.querySelector('.price-row .item-parking') !== null;
            const garage = hasGarage ? 'Sim' : 'Não';

            return { link, price, tipologia, area, garage };
        }).filter(property => property.link.includes('/imovel/'));
    }

    // ===== CRIAÇÃO DO PAINEL ===== //
    function createDataPanel(data) {
        const panel = document.createElement('div');
        panel.id = 'idealistaDataPanel';

        // Cabeçalho
        panel.innerHTML = `
            <div id="idealistaDataHeader">
                <h3 id="idealistaDataTitle">🏠 ${data.length} Imóveis Encontrados</h3>
                <button id="idealistaDismissBtn">✕ Fechar</button>
            </div>
            <div style="overflow-y: auto; max-height: 65vh;">
                <table id="idealistaDataTable">
                    <thead>
                        <tr>
                            <th>Preço</th>
                            <th>Tipologia</th>
                            <th>Área</th>
                            <th class="center">Garagem</th>
                            <th>ID Imóvel</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(property => `
                            <tr>
                                <td class="nowrap">${property.price}</td>
                                <td class="nowrap">${property.tipologia}</td>
                                <td class="nowrap">${property.area}</td>
                                <td class="center">${property.garage}</td>
                                <td><a href="${property.link}" target="_blank" title="${property.link}">${property.link.split('/imovel/')[1].replace('/', '')}</a></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <button id="idealistaCopyCSV">📋 Copiar Tudo como CSV</button>
        `;

        // Event Listeners
        panel.querySelector('#idealistaDismissBtn').addEventListener('click', () => panel.remove());

        panel.querySelector('#idealistaCopyCSV').addEventListener('click', () => {
            const headers = ['Preço', 'Tipologia', 'Área', 'Garagem', 'Link'];
            const csv = [
                headers.join(','),
                ...data.map(p => headers.map(h => {
                    const value = h === 'Link' ? p.link : p[h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
                    return `"${value.replace(/"/g, '""')}"`;
                }).join(','))
            ].join('\n');

            GM_setClipboard(csv, 'text');
            const btn = panel.querySelector('#idealistaCopyCSV');
            btn.textContent = '✓ Copiado!';
            setTimeout(() => btn.textContent = '📋 Copiar Tudo como CSV', 2000);
        });

        document.body.appendChild(panel);
    }

     // ===== EXECUÇÃO ===== //
    const observer = new MutationObserver(() => {
        if (document.querySelector('article.item')) {
            observer.disconnect();
            setTimeout(() => {
                const propertyData = extractPropertyData();
                if (propertyData.length > 0) createDataPanel(propertyData);
            }, 1000);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();