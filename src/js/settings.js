// 导入主题检测器
import { initThemeDetector } from './utils/theme-detector.js';

document.addEventListener('DOMContentLoaded', function() {
    try {
        // 初始化主题检测器
        initThemeDetector();
        
        // 监听主题变化事件
        document.addEventListener('themeChanged', (event) => {
            const isDarkMode = event.detail.isDarkMode;
            console.log(`设置页面主题已更改: ${isDarkMode ? '暗色模式' : '浅色模式'}`);
        });
        
        // 初始化 i18n
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const message = element.getAttribute('data-i18n');
            element.textContent = chrome.i18n.getMessage(message);
        });
        
        // 设置页面标题
        document.title = chrome.i18n.getMessage('settingsTitle');
        
        loadHistory();
    } catch (error) {
        console.error('初始化页面时发生错误:', error);
    }
});

function loadHistory() {
    chrome.storage.local.get(['tabHistory', 'faviconHistory'], function(result) {
        try {
            const history = result.tabHistory || {};
            const faviconHistory = result.faviconHistory || {};
            const tbody = document.querySelector('#historyTable tbody');
            
            if (!tbody) {
                return;
            }
            
            tbody.innerHTML = '';
            
            Object.entries(history).forEach(([url, item], index) => {
                try {
                    const row = createTableRow(url, item, index, faviconHistory[url]);
                    tbody.appendChild(row);
                } catch (error) {
                }
            });
            
            attachDeleteHandlers();
            
        } catch (error) {
        }
    });
}

function createTableRow(url, item, index, faviconData) {
    const row = document.createElement('tr');
    
    // 创建 favicon 显示元素
    const originalFavicon = document.createElement('div');
    originalFavicon.className = 'favicon-display';
    if (item.originalFaviconUrl) {
        originalFavicon.innerHTML = `<img src="${item.originalFaviconUrl}" alt="original favicon">`;
    }

    const newFavicon = document.createElement('div');
    newFavicon.className = 'favicon-display';
    if (faviconData && faviconData.emoji) {
        newFavicon.innerHTML = `<div class="emoji-favicon">${faviconData.emoji}</div>`;
    }

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-btn';
    deleteButton.setAttribute('data-url', url);
    deleteButton.textContent = chrome.i18n.getMessage('deleteButton');

    row.innerHTML = `
        <td>${index + 1}</td>
        <td>${item.originalTitle || ''}</td>
        <td>${item.newTitle || ''}</td>
        <td class="favicon-cell"></td>
        <td class="favicon-cell"></td>
        <td>${url}</td>
        <td></td>
    `;

    row.querySelector('td:nth-child(4)').appendChild(originalFavicon);
    row.querySelector('td:nth-child(5)').appendChild(newFavicon);
    row.querySelector('td:last-child').appendChild(deleteButton);
    
    return row;
}

function attachDeleteHandlers() {
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const url = this.getAttribute('data-url');
            
            if (url && confirm(chrome.i18n.getMessage('deleteConfirm'))) {
                deleteRecord(url);
            }
        });
    });
}

function deleteRecord(url) {
    if (!url) {
        return;
    }
    
    chrome.storage.local.get(['tabHistory', 'faviconHistory'], function(result) {
        try {
            const tabHistory = result.tabHistory || {};
            const faviconHistory = result.faviconHistory || {};
            
            if (!(url in tabHistory)) {
                return;
            }
            
            delete tabHistory[url];
            delete faviconHistory[url];
            
            chrome.storage.local.set({
                tabHistory: tabHistory,
                faviconHistory: faviconHistory
            }, function() {
                if (chrome.runtime.lastError) {
                    return;
                }
                loadHistory();
            });
        } catch (error) {
        }
    });
} 