let tabTitleStorage = {};

function renameTab(newTitle) {
  document.title = newTitle;
}

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        applyCustomizations(tabId, tab.url);
    }
});

// 监听标签页激活事件
chrome.tabs.onActivated.addListener(activeInfo => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url) {
            applyCustomizations(tab.id, tab.url);
        }
    });
});

// 监听导航事件
chrome.webNavigation.onCommitted.addListener(details => {
    applyCustomizations(details.tabId, details.url);
});

// 监听 DOM 内容加载完成事件
chrome.webNavigation.onDOMContentLoaded.addListener(details => {
    applyCustomizations(details.tabId, details.url);
});

// 监听页面加载完成事件
chrome.webNavigation.onCompleted.addListener(details => {
    applyCustomizations(details.tabId, details.url);
});

// 在 background.js 中添加相同的检查函数
function isProtectedPage(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('edge://') || 
           url.startsWith('about:') || 
           url.startsWith('chrome-extension://');
}

// 应用自定义设置的函数
function applyCustomizations(tabId, url) {
    // 如果是受保护的页面，直接返回，不做处理
    if (isProtectedPage(url)) {
        return;
    }

    chrome.storage.local.get(['tabHistory', 'faviconHistory'], function(result) {
        const tabHistory = result.tabHistory || {};
        const faviconHistory = result.faviconHistory || {};

        // 查找所有匹配的设置
        let matchedSettings = [];

        // 遍历所有保存的设置，查找匹配的URL
        Object.entries(tabHistory).forEach(([savedUrl, item]) => {
            // 检查URL是否匹配
            if (isUrlMatched(url, item.customUrl || savedUrl, item.matchRule || 'equals')) {
                // 添加时间戳（如果没有则使用当前时间）
                const settingWithTimestamp = {
                    ...item,
                    savedUrl,
                    timestamp: item.timestamp || Date.now()
                };
                matchedSettings.push(settingWithTimestamp);
            }
        });

        // 如果有匹配的设置，按优先级排序
        if (matchedSettings.length > 0) {
            // 规则类型优先级映射
            const rulePriority = {
                'equals': 1,
                'startsWith': 2,
                'endsWith': 3,
                'contains': 4
            };

            // 按优先级排序：1.规则类型 2.URL长度 3.时间戳
            matchedSettings.sort((a, b) => {
                // 首先按规则类型排序
                const priorityA = rulePriority[a.matchRule || 'equals'];
                const priorityB = rulePriority[b.matchRule || 'equals'];
                
                if (priorityA !== priorityB) {
                    return priorityA - priorityB; // 数字小的优先级高
                }
                
                // 如果规则类型相同，按URL长度排序（长的优先）
                const urlLengthA = (a.customUrl || a.savedUrl).length;
                const urlLengthB = (b.customUrl || b.savedUrl).length;
                
                if (urlLengthA !== urlLengthB) {
                    return urlLengthB - urlLengthA; // 长度大的优先级高
                }
                
                // 如果URL长度也相同，按时间戳排序（新的优先）
                return b.timestamp - a.timestamp;
            });

            // 获取优先级最高的设置
            const topSetting = matchedSettings[0];
            const savedUrl = topSetting.savedUrl;

            // 应用自定义 favicon
            if (faviconHistory[savedUrl] && faviconHistory[savedUrl].emoji) {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: (emojiChar) => {
                        function setFavicon(emoji) {
                            const canvas = document.createElement('canvas');
                            canvas.width = 32;
                            canvas.height = 32;
                            const ctx = canvas.getContext('2d');
                            
                            ctx.font = '32px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            
                            // 检测操作系统
                            const isWindows = navigator.userAgent.toLowerCase().includes('windows');
                            const yPosition = isWindows ? 18 : 20;
                            
                            ctx.fillText(emoji, 16, yPosition);
                            
                            const link = document.createElement('link');
                            link.rel = 'icon';
                            link.href = canvas.toDataURL();
                            
                            // 移除所有现有的 favicon
                            document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());
                            
                            // 添加新的 favicon
                            document.head.appendChild(link);

                            // 防止网站自动恢复 favicon
                            const observer = new MutationObserver((mutations) => {
                                mutations.forEach((mutation) => {
                                    if (mutation.type === 'childList') {
                                        mutation.addedNodes.forEach((node) => {
                                            if (node.tagName === 'LINK' && 
                                                (node.rel === 'icon' || node.rel === 'shortcut icon') && 
                                                node !== link) {
                                                node.remove();
                                            }
                                        });
                                    }
                                });
                            });

                            observer.observe(document.head, {
                                childList: true,
                                subtree: true
                            });
                        }

                        setFavicon(emojiChar);
                    },
                    args: [faviconHistory[savedUrl].emoji]
                }).catch(error => {
                    // 可以在这里显示提示给用户，说明该页面不允许修改 favicon
                });
            }

            // 应用自定义标题
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (title) => { document.title = title; },
                args: [topSetting.newTitle]
            }).catch(error => {
                // 标题更新失败:
            });
        }
    });
}

/**
 * 检查URL是否匹配
 * @param {string} currentUrl 当前URL
 * @param {string} targetUrl 目标URL
 * @param {string} matchRule 匹配规则
 * @returns {boolean} 是否匹配
 */
function isUrlMatched(currentUrl, targetUrl, matchRule) {
    if (!currentUrl || !targetUrl) {
        return false;
    }
    
    switch (matchRule) {
        case 'startsWith':
            return currentUrl.startsWith(targetUrl);
        case 'endsWith':
            return currentUrl.endsWith(targetUrl);
        case 'contains':
            return currentUrl.includes(targetUrl);
        case 'equals':
        default:
            return currentUrl === targetUrl;
    }
}

// 监听消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'faviconUpdated') {
        chrome.tabs.query({url: message.url}, function(tabs) {
            tabs.forEach(tab => {
                applyCustomizations(tab.id, tab.url);
            });
        });
    }
});