chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "renameTab") {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const activeTab = tabs[0];
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: renameTab,
            args: [request.newTitle],
          },
          function () {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
            }
            sendResponse({}); // 将 sendResponse 移动到这里
          }
        );
      });
      return true; // 保持消息通道打开以便稍后发送响应
    }
  });
  
  function renameTab(newTitle) {
    document.title = newTitle;
  }