document.addEventListener("DOMContentLoaded", function () {
  const renameForm = document.getElementById("renameForm");
  const tabTitleInput = document.getElementById("tabTitle");
  document.querySelector("h1").innerText = chrome.i18n.getMessage("appName");
  document.querySelector("label").innerText = chrome.i18n.getMessage("newTabTitle");
  document.querySelector("button").innerText = chrome.i18n.getMessage("renameTabButton");

  // 获取当前标签的标题并填充到input框内
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    tabTitleInput.value = activeTab.title;
  });

  document.addEventListener("DOMContentLoaded", function () {
    
    // ...
  });

  renameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (tabTitleInput.value) {
      chrome.runtime.sendMessage({
        action: "renameTab",
        newTitle: tabTitleInput.value,
      }, function (response) {
        // 在此可以处理来自background.js的响应
      });
    }
  });
});