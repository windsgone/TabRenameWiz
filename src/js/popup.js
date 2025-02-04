import emojiData from './data/emojiData.js';
import { searchEmojis, buildSearchResultsHTML, isInSearchMode, setSearchMode, clearSearch } from './utils/emojiSearch.js';

let scrollListenerEnabled = true;
let scrollTimeout;
let isClickScroll = false;

// 预先对表情进行分类缓存
const EMOJI_CATEGORIES = {
  smileys: [],
  animals: [],
  food: [],
  activity: [],
  travel: [],
  objects: [],
  symbols: [],
  flags: []
};

// 初始化时进行一次性分类
Object.entries(emojiData).forEach(([emoji, data]) => {
  if (EMOJI_CATEGORIES[data.category]) {
    EMOJI_CATEGORIES[data.category].push(emoji);
  }
});

document.addEventListener("DOMContentLoaded", function () {
  const renameForm = document.getElementById("renameForm");
  const tabTitleInput = document.getElementById("tabTitle");
  
  // 初始化 i18n
  document.querySelector("h1").innerText = chrome.i18n.getMessage("appName");
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

  // 表单提交处理
  renameForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    
    const newTitle = tabTitleInput.value.trim();
    
    // 添加空值检查
    if (!newTitle) {
      showMessage('emptyInput', true);
      return;
    }
    
    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const activeTab = tabs[0];
        
        // 检查是否是受保护的页面
        if (isProtectedPage(activeTab.url)) {
            showMessage('protectedPageError', true);
            return;
        }
        
        // 获取当前选中的 emoji（如果有的话）
        const emojiFavicon = document.querySelector('.emoji-favicon');
        const emoji = emojiFavicon ? emojiFavicon.textContent : null;

        // 先尝试更新标题
        try {
            await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: (title) => {
                    // 保存原始标题
                    if (!document.querySelector('title').hasAttribute('data-original-title')) {
                        document.querySelector('title').setAttribute('data-original-title', document.title);
                    }
                    document.title = title;
                },
                args: [newTitle]
            });

            // 如果有 emoji，更新 favicon
            if (emoji) {
                await chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    func: (emojiChar) => {
                        // 保存原始 favicon
                        const originalFavicon = document.querySelector('link[rel*="icon"]');
                        if (originalFavicon && !document.querySelector('link[data-original-favicon="true"]')) {
                            const original = originalFavicon.cloneNode(true);
                            original.setAttribute('data-original-favicon', 'true');
                            original.setAttribute('rel', 'original-favicon');
                            document.head.appendChild(original);
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = 32;
                        canvas.height = 32;
                        const ctx = canvas.getContext('2d');
                        ctx.font = '32px serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(emojiChar, 16, 20);
                        
                        const link = document.createElement('link');
                        link.rel = 'icon';
                        link.href = canvas.toDataURL();
                        
                        // 移除所有现有的 favicon（除了原始的）
                        document.querySelectorAll('link[rel*="icon"]:not([data-original-favicon="true"])').forEach(el => el.remove());
                        
                        // 添加新的 favicon
                        document.head.appendChild(link);

                        // 防止网站自动恢复 favicon
                        const observer = new MutationObserver((mutations) => {
                            mutations.forEach((mutation) => {
                                if (mutation.type === 'childList') {
                                    mutation.addedNodes.forEach((node) => {
                                        if (node.tagName === 'LINK' && 
                                            (node.rel === 'icon' || node.rel === 'shortcut icon') && 
                                            !node.hasAttribute('data-original-favicon') &&
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

                        // 在标签页关闭或导航离开时
                        observer.disconnect();
                    },
                    args: [emoji]
                });
            }

            // 只有在成功执行后才保存到存储
            chrome.storage.local.get(['tabHistory', 'faviconHistory'], async function(result) {
                const tabHistory = result.tabHistory || {};
                const faviconHistory = result.faviconHistory || {};
                
                // 获取原始状态
                const originalState = await getOriginalState(activeTab.url);
                
                // 更新标题历史
                if (!tabHistory[activeTab.url]) {
                    // 首次保存，记录完整信息
                    tabHistory[activeTab.url] = {
                        originalTitle: originalState.originalTitle,
                        originalFaviconUrl: originalState.originalFaviconUrl,
                        newTitle: newTitle,
                        url: activeTab.url
                    };
                } else {
                    // 已存在记录，只更新新标题
                    tabHistory[activeTab.url].newTitle = newTitle;
                }
                
                // 如果有选择 emoji，更新 favicon 历史
                if (emoji) {
                    faviconHistory[activeTab.url] = {
                        emoji: emoji,
                        url: activeTab.url,
                        timestamp: new Date().getTime()
                    };
                }
                
                // 保存到 storage
                chrome.storage.local.set({
                    tabHistory: tabHistory,
                    faviconHistory: faviconHistory
                }, function() {
                    // 通知 background 脚本更新已完成
                    chrome.runtime.sendMessage({
                        type: 'faviconUpdated',
                        url: activeTab.url,
                        emoji: emoji
                    });

                    showMessage('renameSuccess');
                });
            });

        } catch (error) {
            console.error('执行脚本失败:', error);
            showMessage('renameFailed', true);
        }
    } catch (error) {
        console.error('操作失败:', error);
        showMessage('executionError', true);
    }
  });

  // 清除按钮事件
  document.getElementById('clearBtn').addEventListener('click', function() {
    tabTitleInput.value = '';
  });

  // 初始化 Favicon 功能
  initFaviconFeature();
});

function initFaviconFeature() {
  const faviconBox = document.getElementById('faviconBox');
  const emojiPicker = document.getElementById('emojiPicker');
  const currentFavicon = document.getElementById('currentFavicon');
  const emojiContent = document.querySelector('.emoji-content');
  
  // 确保元素存在
  if (!faviconBox || !emojiPicker || !currentFavicon || !emojiContent) {
    console.error('Required elements not found');
    return;
  }

  // 设置初始状态
  emojiPicker.style.display = 'none';

  // 修改点击事件处理
  faviconBox.addEventListener('click', function(e) {
    e.stopPropagation();
    if (emojiPicker) {
      const isHidden = window.getComputedStyle(emojiPicker).display === 'none';
      emojiPicker.style.display = isHidden ? 'block' : 'none';
      // 添加或移除高亮类
      faviconBox.classList.toggle('active', isHidden);
      
      // 仅在首次显示时初始化表情内容
      if (isHidden && emojiContent.children.length === 0) {
        showEmojiCategory('smileys');
      }
    }
  });

  // 初始化时获取当前标签页的 favicon
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const activeTab = tabs[0];
    // 检查是否有自定义 emoji favicon
    chrome.storage.local.get(['faviconHistory'], function(result) {
      const faviconHistory = result.faviconHistory || {};
      if (faviconHistory[activeTab.url]) {
        // 如果有自定义 emoji，显示它
        currentFavicon.style.display = 'none';
        const emojiFavicon = document.createElement('div');
        emojiFavicon.className = 'emoji-favicon';
        emojiFavicon.textContent = faviconHistory[activeTab.url].emoji;
        faviconBox.appendChild(emojiFavicon);
      } else {
        // 否则显示原始 favicon
        currentFavicon.style.display = 'block';
        currentFavicon.src = activeTab.favIconUrl || '';
      }
    });
  });

  // 在 initFaviconFeature 函数中添加
  const searchInput = document.querySelector('.search-input');
  const searchClear = document.querySelector('.search-clear');

  // 处理搜索输入
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const keyword = e.target.value;
    
    // 控制清除按钮的显示/隐藏
    searchClear.style.display = keyword ? 'flex' : 'none';
    
    searchTimer = setTimeout(() => {
      if (!keyword.trim()) {
        clearSearch(searchInput, emojiContent);
        showEmojiCategory('smileys');
        return;
      }

      setSearchMode(true);
      const { results, isEmpty } = searchEmojis(keyword);
      
      // 清空现有内容
      emojiContent.innerHTML = '';
      // 显示搜索结果
      emojiContent.appendChild(buildSearchResultsHTML(results));
    }, 300);
  });

  // 添加清除按钮点击事件
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    clearSearch(searchInput, emojiContent);
    showEmojiCategory('smileys');
  });

  function showEmojiCategory(categoryName) {
    if (isInSearchMode()) {
      return; // 搜索模式下不显示分类
    }
    // 如果是第一次加载，加载所有分类
    if (emojiContent.children.length === 0) {
      // 清空内容区域
      emojiContent.innerHTML = '';
      
      // 添加所有分类
      Object.keys(EMOJI_CATEGORIES).forEach(category => {
        // 创建分类容器
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'emoji-category';
        categoryDiv.dataset.category = category;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'category-title';
        titleDiv.textContent = chrome.i18n.getMessage(`emoji_category_${category}`);
        categoryDiv.appendChild(titleDiv);

        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'emoji-grid';

        // 使用 DocumentFragment 优化 DOM 操作
        const fragment = document.createDocumentFragment();
        EMOJI_CATEGORIES[category].forEach(emoji => {
          const emojiItem = document.createElement('div');
          emojiItem.className = 'emoji-item';
          emojiItem.textContent = emoji;
          emojiItem.dataset.emoji = emoji;
          fragment.appendChild(emojiItem);
        });

        emojiGrid.appendChild(fragment);
        categoryDiv.appendChild(emojiGrid);
        emojiContent.appendChild(categoryDiv);
      });
    }

    // 滚动到选中的分类
    const selectedCategory = emojiContent.querySelector(`[data-category="${categoryName}"]`);
    if (selectedCategory) {
        // 临时禁用平滑滚动
        emojiContent.style.scrollBehavior = 'auto';
        selectedCategory.scrollIntoView();
        // 恢复平滑滚动
        setTimeout(() => {
            emojiContent.style.scrollBehavior = 'smooth';
        }, 0);
    }
  }

  // 使用事件委托处理 emoji 点击
  emojiContent.addEventListener('click', (event) => {
    const emojiItem = event.target.closest('.emoji-item');
    if (emojiItem) {
      const emoji = emojiItem.dataset.emoji;
      if (emoji) {
        selectEmoji(emoji);
      }
    }
  });

  function selectEmoji(emoji) {
    faviconBox.querySelector('.emoji-favicon')?.remove();
    currentFavicon.style.display = 'none';
    
    const emojiFavicon = document.createElement('div');
    emojiFavicon.className = 'emoji-favicon';
    emojiFavicon.textContent = emoji;
    faviconBox.appendChild(emojiFavicon);

    hideEmojiPicker();
    // 移除 active 类
    faviconBox.classList.remove('active');
  }

  function hideEmojiPicker() {
    emojiPicker.style.display = 'none';
    // 移除 active 类
    faviconBox.classList.remove('active');
  }

  // 使用事件委托处理分类标签点击
  const emojiTabs = document.querySelector('.emoji-tabs');
  emojiTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) {
      const categoryName = tab.dataset.category;
      isClickScroll = true;
      updateActiveTab(categoryName);
      showEmojiCategory(categoryName);
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isClickScroll = false;
      }, 500);
    }
  });

  // 优化滚动事件监听器（使用节流）
  let scrollTimer = null;
  let lastScrollPosition = 0;
  
  emojiContent.addEventListener('scroll', () => {
    if (isClickScroll) return;
    
    if (scrollTimer) return;
    
    scrollTimer = setTimeout(() => {
      // 获取滚动方向
      const currentScroll = emojiContent.scrollTop;
      const scrollingDown = currentScroll > lastScrollPosition;
      lastScrollPosition = currentScroll;

      const containerRect = emojiContent.getBoundingClientRect();
      const containerTop = containerRect.top;
      
      // 检查可见区域中的分类
      const categories = emojiContent.querySelectorAll('.emoji-category');
      let visibleCategory = null;
      
      for (const category of categories) {
        const rect = category.getBoundingClientRect();
        const relativeTop = rect.top - containerTop;
        
        if (relativeTop <= 10) {
          visibleCategory = category.dataset.category;
        }
      }

      if (visibleCategory) {
        updateActiveTab(visibleCategory);
      }

      scrollTimer = null;
    }, 100);
  });

  function updateActiveTab(categoryName) {
    const tabs = document.querySelectorAll('.emoji-tabs .tab');
    tabs.forEach(tab => {
      if (tab.dataset.category === categoryName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  // 点击其他区域关闭表情选择器
  document.addEventListener('click', function(event) {
    const isClickInside = faviconBox.contains(event.target) || 
                         emojiPicker.contains(event.target);
    if (!isClickInside) {
      hideEmojiPicker();
      // 这里不需要额外移除 active 类，因为 hideEmojiPicker 已经处理了
    }
  });
}

// 显示消息函数
function showMessage(messageKey, isError = false) {
  const messageElement = document.getElementById('message');
  messageElement.textContent = chrome.i18n.getMessage(messageKey);
  messageElement.className = `message ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    messageElement.textContent = '';
    messageElement.className = 'message';
  }, 3000);
}

document.getElementById('settingsIcon').addEventListener('click', function() {
  chrome.tabs.create({
      url: 'html/settings.html'
  });
});

// 在 popup.js 中添加检查函数
function isProtectedPage(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('edge://') || 
           url.startsWith('about:') || 
           url.startsWith('chrome-extension://');
}

// 添加新函数
async function getOriginalState(url) {
    const result = await chrome.storage.local.get(['tabHistory']);
    const tabHistory = result.tabHistory || {};
    
    // 如果已存在记录，返回原有的原始状态
    if (tabHistory[url]) {
        return {
            originalTitle: tabHistory[url].originalTitle,
            originalFaviconUrl: tabHistory[url].originalFaviconUrl
        };
    }
    
    // 如果是新记录，获取当前标签的原始状态
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    const activeTab = tabs[0];

    // 获取当前页面的原始标题
    try {
        const [titleResult] = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => document.querySelector('title')?.getAttribute('data-original-title') || document.title
        });

        // 获取当前页面的原始图标
        const [faviconResult] = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
                const originalFavicon = document.querySelector('link[data-original-favicon="true"]');
                if (originalFavicon) {
                    return originalFavicon.href;
                }
                const favicon = document.querySelector('link[rel*="icon"]');
                return favicon ? favicon.href : null;
            }
        });

        return {
            originalTitle: titleResult.result,
            originalFaviconUrl: faviconResult.result || activeTab.favIconUrl
        };
    } catch (error) {
        return {
            originalTitle: activeTab.title,
            originalFaviconUrl: activeTab.favIconUrl
        };
    }
}