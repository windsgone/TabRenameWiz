let tabTitleStorage = {};

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "renameTab") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const activeTab = tabs[0];
      
      // 检查是否是特殊页面，扩展检查范围
      if (activeTab.url.startsWith('chrome://') || 
          activeTab.url.startsWith('chrome-extension://') ||
          activeTab.url.startsWith('edge://') ||
          activeTab.url.startsWith('about:') ||
          activeTab.url.startsWith('file://')) {
        console.log('无法修改受保护的页面标题:', activeTab.url);  // 使用更友好的日志信息
        sendResponse({ 
          success: false, 
          error: 'protected_page'  // 添加错误类型
        });
        return;
      }

      try {
        // 获取现有历史记录
        chrome.storage.local.get(['tabHistory'], function(result) {
          let history = result.tabHistory || {};
          
          // 准备新的标签数据
          const tabData = {
            // 如果已存在记录则保留原始标题，否则使用当前标题
            originalTitle: history[activeTab.url] 
              ? history[activeTab.url].originalTitle 
              : activeTab.title,
            newTitle: request.newTitle,
            url: activeTab.url,
            timestamp: new Date().getTime()
          };
          
          // 更新存储
          history[activeTab.url] = tabData;
          chrome.storage.local.set({ tabHistory: history });
          
          // 执行重命名脚本
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: renameTab,
            args: [request.newTitle]
          }).then(() => {
            tabTitleStorage[activeTab.id] = request.newTitle;
            sendResponse({ success: true });
          }).catch((error) => {
            console.log('重命名操作失败:', error.message);
            sendResponse({ 
              success: false, 
              error: 'execution_failed'
            });
          });
        });
      } catch (error) {
        console.log('执行过程发生错误:', error.message);  // 使用更友好的日志信息
        sendResponse({ 
          success: false, 
          error: 'unknown_error'  // 添加错误类型
        });
      }
    });
    return true;
  }
});

function renameTab(newTitle) {
  document.title = newTitle;
}

// 监听标签页加载完成事件
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === "complete") {
    chrome.storage.local.get(['tabHistory'], function(result) {
      const history = result.tabHistory || {};
      // 检查当前URL是否存在于历史记录中
      if (history[tab.url]) {
        tabTitleStorage[tabId] = history[tab.url].newTitle;
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: renameTab,
          args: [history[tab.url].newTitle]
        }).catch(err => console.error('执行脚本失败:', err));
      }
    });
  }
});