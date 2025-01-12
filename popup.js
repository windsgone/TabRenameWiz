document.addEventListener("DOMContentLoaded", function () {
  const renameForm = document.getElementById("renameForm");
  const tabTitleInput = document.getElementById("tabTitle");
  document.querySelector("h1").innerText = chrome.i18n.getMessage("appName");
  document.querySelector("label").innerText = chrome.i18n.getMessage("newTabTitle");
  document.querySelector("button").innerText = chrome.i18n.getMessage("renameTabButton");

  // 获取当前标签的标题并填充到input框内
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    chrome.storage.local.get(['tabHistory'], function(result) {
      const history = result.tabHistory || {};
      if (history[activeTab.url]) {
        tabTitleInput.value = history[activeTab.url].newTitle;
      } else {
        tabTitleInput.value = activeTab.title;
      }
    });
  });

  document.addEventListener("DOMContentLoaded", function () {
    
    // ...
  });

  document.getElementById('clearBtn').addEventListener('click', function() {
    document.getElementById('tabTitle').value = '';
});

function showMessage(messageKey, isError = false) {
  const messageElement = document.getElementById('message');
  messageElement.textContent = chrome.i18n.getMessage(messageKey);
  messageElement.className = `message ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    messageElement.textContent = '';
    messageElement.className = 'message';
  }, 3000);
}

  renameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const title = tabTitleInput.value.trim();
    
    // 检查是否为空
    if (!title) {
      showMessage('emptyInput', true);
      return;
    }

    // 检查长度
    if (title.length > 200) {
      showMessage('maxLengthExceeded', true);
      return;
    }


    chrome.runtime.sendMessage({
      action: "renameTab",
      newTitle: title,
    }, function (response) {
      if (response) {
        if (response.success) {
          showMessage('renameSuccess');
        } else {
          // 根据错误类型显示不同的错误消息
          switch(response.error) {
            case 'protected_page':
              showMessage('protectedPageError', true);
              break;
            case 'execution_failed':
              showMessage('executionError', true);
              break;
            default:
              showMessage('renameFailed', true);
          }
        }
      }
    });
  });

  document.getElementById('settingsIcon').addEventListener('click', function() {
    chrome.tabs.create({
        url: 'settings.html'
    });
  });
});