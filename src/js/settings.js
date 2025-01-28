document.addEventListener('DOMContentLoaded', function() {
    // 初始化 i18n
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const message = element.getAttribute('data-i18n');
        element.textContent = chrome.i18n.getMessage(message);
    });
    
    // 设置页面标题
    document.title = chrome.i18n.getMessage('settingsTitle');
    
    loadHistory();
});

function loadHistory() {
    chrome.storage.local.get(['tabHistory'], function(result) {
        const history = result.tabHistory || {};
        const tbody = document.querySelector('#historyTable tbody');
        tbody.innerHTML = '';
        
        Object.values(history).forEach((item, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.originalTitle}</td>
                <td>${item.newTitle}</td>
                <td>${item.url}</td>
                <td>
                    <button class="delete-btn" data-url="${item.url}">${chrome.i18n.getMessage('deleteButton')}</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const url = this.getAttribute('data-url');
                if (confirm(chrome.i18n.getMessage('deleteConfirm'))) {
                    deleteRecord(url);
                }
            });
        });
    });
}

function deleteRecord(url) {
    chrome.storage.local.get(['tabHistory'], function(result) {
        let history = result.tabHistory || {};
        delete history[url];
        chrome.storage.local.set({ tabHistory: history }, function() {
            loadHistory();
        });
    });
} 