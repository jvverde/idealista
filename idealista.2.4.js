// ==UserScript==
// @name         Idealista Extractor Completo: Preço, Área, Tipologia, Garagem
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Extrai preço, área bruta, tipologia, garagem e links visíveis
// @author       Você
// @match        https://www.idealista.pt/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

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
        const currentPath = window.location.pathname;
        return allowedPaths.some(regex => regex.test(currentPath));
    }

    if (!isIdealistaListingPage()) return;

    // ===== ESTILOS ===== //
    GM_addStyle(`
        #idealistaDataPanel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 650px;
            max-height: 80vh;
            overflow-y: auto;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 2px 15px rgba(0,0,0,0.1);
            padding: 15px;
            z-index: 9999;
            font-family: Arial, sans-serif;
            font-size: 13px;
        }
        /* ... (mantenha os mesmos estilos anteriores) ... */
        .compact-cell { white-space: nowrap; }
    `);

    // ===== EXTRAÇÃO DE DADOS ===== //
    function extractPropertyData() {
        const baseUrl = 'https://www.idealista.pt';
        const items = document.querySelectorAll('article.item');

        return Array.from(items).map(item => {
            // Link
            const linkElement = item.querySelector('a.item-link');
            const link = linkElement ? baseUrl + linkElement.getAttribute('href') : '';

            // Preço
            const priceElement = item.querySelector('span.item-price');
            const price = priceElement ? priceElement.textContent.trim().replace(/\s+/g, ' ') : 'N/A';

            // Tipologia (T1, T2, etc.)
            const tipologiaElement = item.querySelector('.item-detail-char .item-detail:first-child');
            const tipologia = tipologiaElement ? tipologiaElement.textContent.match(/T\d+/)?.[0] || 'N/A' : 'N/A';

            // Área Bruta
            const areaElement = Array.from(item.querySelectorAll('.item-detail-char .item-detail'))
                .find(el => el.textContent.includes('m²'));
            const area = areaElement ? areaElement.textContent.replace(/(\d+) m².*/, '$1 m²') : 'N/A';

            // Garagem
            const garageIcon = item.querySelector('svg.icon-parking, .icon-garage');
            const garageText = Array.from(item.querySelectorAll('span.item-detail'))
                .find(el => /garagem|estacionamento|parking/i.test(el.textContent));
            const garage = (garageIcon || garageText) ? 'Sim' : 'Não';

            return { link, price, tipologia, area, garage };
        }).filter(property => property.link);
    }

    // ===== CRIAÇÃO DO PAINEL ===== //
    function createDataPanel(data) {
        const panel = document.createElement('div');
        panel.id = 'idealistaDataPanel';

        // Cabeçalho
        const header = document.createElement('div');
        header.id = 'idealistaDataHeader';
        header.innerHTML = `
            <h3 id="idealistaDataTitle">Imóveis Encontrados: ${data.length}</h3>
            <button id="idealistaDismissBtn">X</button>
        `;
        header.querySelector('#idealistaDismissBtn').addEventListener('click', () => panel.remove());

        // Tabela
        const table = document.createElement('table');
        table.id = 'idealistaDataTable';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Preço</th>
                    <th>Tipologia</th>
                    <th>Área Bruta</th>
                    <th>Garagem</th>
                    <th>Link</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(property => `
                    <tr>
                        <td class="compact-cell">${property.price}</td>
                        <td class="compact-cell">${property.tipologia}</td>
                        <td class="compact-cell">${property.area}</td>
                        <td class="compact-cell">${property.garage}</td>
                        <td><a href="${property.link}" target="_blank" title="${property.link}">${property.link.split('/imovel/')[1].replace('/', '')}</a></td>
                    </tr>
                `).join('')}
            </tbody>
        `;

        // Botão Copiar CSV
        const copyBtn = document.createElement('button');
        copyBtn.id = 'idealistaCopyCSV';
        copyBtn.textContent = 'Copiar Dados (CSV)';
        copyBtn.addEventListener('click', () => {
            const csvData = [
                ['Preço', 'Tipologia', 'Área Bruta', 'Garagem', 'Link'],
                ...data.map(p => [p.price, p.tipologia, p.area, p.garage, p.link])
            ].map(row => row.map(field => `"${field.replace(/"/g, '""')}"`).join(',')).join('\n');

            GM_setClipboard(csvData, 'text');
            copyBtn.textContent = 'Copiado!';
            setTimeout(() => copyBtn.textContent = 'Copiar Dados (CSV)', 2000);
        });

        panel.appendChild(header);
        panel.appendChild(table);
        panel.appendChild(copyBtn);
        document.body.appendChild(panel);
    }

    // ===== EXECUÇÃO ===== //
    setTimeout(() => {
        try {
            const propertyData = extractPropertyData();
            if (propertyData.length > 0) {
                createDataPanel(propertyData);
            } else {
                console.log('[Idealista Extractor] Nenhum imóvel encontrado.');
            }
        } catch (error) {
            console.error('[Idealista Extractor] Erro:', error);
        }
    }, 3500);
})();