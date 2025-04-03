import emojiData from './data/emojiData.js';
import { searchEmojis, buildSearchResultsHTML, isInSearchMode, setSearchMode, clearSearch } from './utils/emojiSearch.js';
import { MATCH_RULES, createUrlMatcherUI } from './utils/urlMatcher.js';

let scrollListenerEnabled = true;
let scrollTimeout;
let isClickScroll = false;

// 预先对表情进行分类缓存
const EMOJI_CATEGORIES = {
  frequently: [], // 新增常用表情分类
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

// 常用表情管理
const FREQUENTLY_USED_MAX = 18; // 常用表情最大数量
let addEmojiDebounceTimer;
let selectedEmoji; // 添加全局变量存储选中的表情

// 添加到常用表情列表
async function addToFrequentlyUsed(emoji) {
  if (addEmojiDebounceTimer) {
    clearTimeout(addEmojiDebounceTimer);
  }

  addEmojiDebounceTimer = setTimeout(async () => {
    try {
      const result = await chrome.storage.local.get(['frequentlyUsedEmojis']);
      let frequentlyUsed = result.frequentlyUsedEmojis || [];
      
      // 检查是否已存在
      const existingIndex = frequentlyUsed.findIndex(item => item.emoji === emoji);
      
      if (existingIndex !== -1) {
        // 已存在，更新时间戳并移到首位
        frequentlyUsed.splice(existingIndex, 1);
      }
      
      // 添加新记录到开头
      frequentlyUsed.unshift({
        emoji,
        timestamp: Date.now()
      });
      
      // 限制数量
      if (frequentlyUsed.length > FREQUENTLY_USED_MAX) {
        frequentlyUsed = frequentlyUsed.slice(0, FREQUENTLY_USED_MAX);
      }
      
      // 更新存储
      await chrome.storage.local.set({ frequentlyUsedEmojis: frequentlyUsed });
      
      // 更新 EMOJI_CATEGORIES 中的常用表情列表
      EMOJI_CATEGORIES.frequently = frequentlyUsed.map(item => item.emoji);
      
      // 如果当前在常用分类，刷新显示
      if (document.querySelector('.emoji-tabs .tab.active')?.dataset.category === 'frequently') {
        const frequentlyGrid = document.querySelector('[data-category="frequently"] .emoji-grid');
        if (frequentlyGrid) {
          // 清空现有内容
          frequentlyGrid.innerHTML = '';
          
          // 重新渲染常用表情
          EMOJI_CATEGORIES.frequently.forEach(emoji => {
            const emojiItem = document.createElement('div');
            emojiItem.className = 'emoji-item';
            emojiItem.textContent = emoji;
            emojiItem.dataset.emoji = emoji;
            frequentlyGrid.appendChild(emojiItem);
          });
        }
      }
    } catch (error) {
      console.error('添加常用表情失败:', error);
    }
  }, 300); // 300ms 防抖
}

document.addEventListener("DOMContentLoaded", function () {
  const renameForm = document.getElementById("renameForm");
  const tabTitleInput = document.getElementById("tabTitle");
  const urlMatcherContainer = document.getElementById("urlMatcherContainer");
  let urlMatcher; // URL匹配规则UI组件实例
  
  // 初始化 i18n
  document.querySelector("h1").innerText = chrome.i18n.getMessage("appName");
  document.querySelector("button").innerText = chrome.i18n.getMessage("renameTabButton");

  // 获取当前标签的标题并填充到input框内
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    chrome.storage.local.get(['tabHistory'], function(result) {
      const history = result.tabHistory || {};
      
      // 查找匹配的设置
      let matchedSettings = [];
      
      // 遍历所有保存的设置，查找匹配的URL
      Object.entries(history).forEach(([savedUrl, item]) => {
        // 检查URL是否匹配
        if (isUrlMatched(activeTab.url, item.customUrl || savedUrl, item.matchRule || 'equals')) {
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
        
        // 使用优先级最高的设置
        tabTitleInput.value = topSetting.newTitle;
        
        // 初始化URL匹配规则UI，使用匹配的规则和URL
        initUrlMatcher(activeTab.url, topSetting, topSetting.savedUrl);
      } else if (history[activeTab.url]) {
        // 如果当前URL有保存的设置，使用它
        tabTitleInput.value = history[activeTab.url].newTitle;
        
        // 初始化URL匹配规则UI
        initUrlMatcher(activeTab.url, history[activeTab.url]);
      } else {
        // 否则使用默认值
        tabTitleInput.value = activeTab.title;
        
        // 初始化URL匹配规则UI（使用默认值）
        initUrlMatcher(activeTab.url);
      }
    });
  });
  
  /**
   * 初始化URL匹配规则UI
   * @param {string} currentUrl 当前URL
   * @param {Object} historyItem 历史记录项
   * @param {string} matchedUrl 匹配的URL（如果有）
   */
  function initUrlMatcher(currentUrl, historyItem, matchedUrl) {
    // 初始状态
    const initialState = {
      matchRule: historyItem ? historyItem.matchRule || MATCH_RULES.EQUALS : MATCH_RULES.EQUALS,
      customUrl: historyItem ? historyItem.customUrl || (matchedUrl || currentUrl) : currentUrl,
      expanded: false,
      isMatched: !!matchedUrl && matchedUrl !== currentUrl,
      currentUrl: currentUrl
    };
    
    // 创建URL匹配规则UI
    urlMatcher = createUrlMatcherUI(urlMatcherContainer, initialState, function(state) {
      // 状态变更回调
      console.log('URL匹配规则状态变更:', state);
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
      case MATCH_RULES.STARTS_WITH:
        return currentUrl.startsWith(targetUrl);
      case MATCH_RULES.ENDS_WITH:
        return currentUrl.endsWith(targetUrl);
      case MATCH_RULES.CONTAINS:
        return currentUrl.includes(targetUrl);
      case MATCH_RULES.EQUALS:
      default:
        return currentUrl === targetUrl;
    }
  }

  // 表单提交处理
  renameForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    
    const tabTitle = tabTitleInput.value.trim();
    
    if (tabTitle === "") {
      // 如果标题为空，显示错误提示
      showMessage(chrome.i18n.getMessage("titleEmptyError"), "error");
      return;
    }
    
    // 获取当前标签信息
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    
    // 获取URL匹配规则状态
    const urlMatcherState = urlMatcher.getState();
    const matchRule = urlMatcherState.matchRule;
    const customUrl = urlMatcherState.customUrl.trim();
    
    // 保存到历史记录
    chrome.storage.local.get(['tabHistory'], function(result) {
      const history = result.tabHistory || {};
      
      // 检查是否匹配当前URL
      const isMatch = isUrlMatched(activeTab.url, customUrl, matchRule);
      
      // 保存设置
      history[activeTab.url] = {
        newTitle: tabTitle,
        matchRule: matchRule,
        customUrl: customUrl,
        timestamp: Date.now() // 添加时间戳
      };
      
      chrome.storage.local.set({ tabHistory: history }, function() {
        if (isMatch) {
          // 如果匹配，应用设置
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (title) => { document.title = title; },
            args: [tabTitle]
          }).then(() => {
            showMessage(chrome.i18n.getMessage("saveSuccess"), "success");
          }).catch(error => {
            showMessage(chrome.i18n.getMessage("generalError"), "error");
          });
        } else {
          // 如果不匹配，显示提示
          showMessage(chrome.i18n.getMessage("urlNotMatch"), "info");
        }
      });
    });
    
    // 保存 favicon
    if (selectedEmoji) {
      chrome.storage.local.get(['faviconHistory'], function(result) {
        const faviconHistory = result.faviconHistory || {};
        faviconHistory[activeTab.url] = { emoji: selectedEmoji };
        chrome.storage.local.set({ faviconHistory: faviconHistory });
      });
    }
  });
  
  /**
   * 检查URL是否匹配
   * @param {string} currentUrl 当前URL
   * @param {string} targetUrl 目标URL
   * @param {string} matchRule 匹配规则
   * @returns {boolean} 是否匹配
   */
  function isUrlMatch(currentUrl, targetUrl, matchRule) {
    if (!currentUrl || !targetUrl) {
      return false;
    }
    
    switch (matchRule) {
      case MATCH_RULES.STARTS_WITH:
        return currentUrl.startsWith(targetUrl);
      case MATCH_RULES.ENDS_WITH:
        return currentUrl.endsWith(targetUrl);
      case MATCH_RULES.CONTAINS:
        return currentUrl.includes(targetUrl);
      case MATCH_RULES.EQUALS:
      default:
        return currentUrl === targetUrl;
    }
  }
  
  /**
   * 保存设置到存储
   * @param {Object} activeTab 当前标签页
   * @param {string} newTitle 新标题
   * @param {string} emoji Emoji图标
   * @param {Object} matcherState URL匹配规则状态
   */
  async function saveSettings(activeTab, newTitle, emoji, matcherState) {
    // 获取原始状态
    const originalState = await getOriginalState(activeTab.url);
    
    // 保存到存储
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['tabHistory', 'faviconHistory'], async function(result) {
        try {
          const tabHistory = result.tabHistory || {};
          const faviconHistory = result.faviconHistory || {};
          
          // 更新标题历史
          if (!tabHistory[activeTab.url]) {
            // 首次保存，记录完整信息
            tabHistory[activeTab.url] = {
              originalTitle: originalState.originalTitle,
              originalFaviconUrl: originalState.originalFaviconUrl,
              newTitle: newTitle,
              url: activeTab.url,
              matchRule: matcherState.matchRule || 'equals',
              customUrl: matcherState.customUrl || activeTab.url
            };
          } else {
            // 已存在记录，更新信息
            tabHistory[activeTab.url].newTitle = newTitle;
            tabHistory[activeTab.url].matchRule = matcherState.matchRule;
            tabHistory[activeTab.url].customUrl = matcherState.customUrl;
          }
          
          // 如果有选择 emoji，更新 favicon 历史
          if (emoji) {
            faviconHistory[activeTab.url] = {
              emoji: emoji,
              url: activeTab.url,
              timestamp: Date.now()
            };
            
            // 添加到常用表情
            addToFrequentlyUsed(emoji);
          }
          
          // 保存到存储
          chrome.storage.local.set({
            tabHistory: tabHistory,
            faviconHistory: faviconHistory
          }, function() {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

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
      
      // 立即显示选择器
      emojiPicker.style.display = isHidden ? 'block' : 'none';
      faviconBox.classList.toggle('active', isHidden);
      
      if (isHidden) {
        // 显示加载动画
        emojiContent.innerHTML = `
          <div class="loading-spinner">
            <div class="spinner"></div>
          </div>
        `;
        
        // 确保搜索框为空
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
          searchInput.value = '';
        }
        const searchClear = document.querySelector('.search-clear');
        if (searchClear) {
          searchClear.style.display = 'none';
        }
        
        // 重置搜索模式
        if (isInSearchMode()) {
          clearSearch(document.querySelector('.search-input'), emojiContent);
        }
        
        // 直接加载表情，不使用requestAnimationFrame
        showEmojiCategory('frequently');
        // 确保标签状态正确
        updateActiveTab('frequently');
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
        showEmojiCategory('frequently');
        updateActiveTab('frequently');
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
    showEmojiCategory('frequently');
    updateActiveTab('frequently');
  });

  async function showEmojiCategory(categoryName) {
    if (isInSearchMode()) {
        return;
    }
    
    // 如果是常用分类，特殊处理
    if (categoryName === 'frequently') {
      try {
        const result = await chrome.storage.local.get(['frequentlyUsedEmojis']);
        const frequentlyUsed = result.frequentlyUsedEmojis || [];
        
        // 更新 EMOJI_CATEGORIES
        EMOJI_CATEGORIES.frequently = frequentlyUsed.map(item => item.emoji);
      } catch (error) {
        console.error('获取常用表情失败:', error);
        EMOJI_CATEGORIES.frequently = [];
      }
    }
    
    // 清空现有内容，重新创建
    emojiContent.innerHTML = '';
    
    // 创建所有分类的容器
    Object.keys(EMOJI_CATEGORIES).forEach(category => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'emoji-category';
        categoryDiv.dataset.category = category;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'category-title';
        titleDiv.textContent = chrome.i18n.getMessage(`emoji_category_${category}`) || category;
        categoryDiv.appendChild(titleDiv);

        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'emoji-grid';
        
        // 立即填充表情
        EMOJI_CATEGORIES[category].forEach(emoji => {
            const emojiItem = document.createElement('div');
            emojiItem.className = 'emoji-item';
            emojiItem.textContent = emoji;
            emojiItem.dataset.emoji = emoji;
            emojiGrid.appendChild(emojiItem);
        });
        
        categoryDiv.appendChild(emojiGrid);
        emojiContent.appendChild(categoryDiv);
    });
    
    // 移除加载动画
    const loadingSpinner = emojiContent.querySelector('.loading-spinner');
    if (loadingSpinner) {
        loadingSpinner.remove();
    }
    
    // 滚动到选中的分类
    const selectedCategory = emojiContent.querySelector(`[data-category="${categoryName}"]`);
    if (selectedCategory) {
        selectedCategory.scrollIntoView({
            behavior: 'auto',
            block: 'start'
        });
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

    // 设置全局变量
    selectedEmoji = emoji;
    
    // 添加到常用表情
    addToFrequentlyUsed(emoji);
    
    // 修改：先重置表情选择器状态，再隐藏
    if (isInSearchMode()) {
      const searchInput = document.querySelector('.search-input');
      if (searchInput) {
        searchInput.value = '';
      }
      clearSearch(document.querySelector('.search-input'), emojiContent);
    }
    
    // 确保常用表情分类被更新
    updateActiveTab('frequently');
    
    hideEmojiPicker();
    faviconBox.classList.remove('active');
  }

  function hideEmojiPicker() {
    emojiPicker.style.display = 'none';
    // 移除 active 类
    faviconBox.classList.remove('active');
    
    // 添加：确保下次打开时能正确显示表情
    // 重置搜索状态
    if (isInSearchMode()) {
      const searchInput = document.querySelector('.search-input');
      if (searchInput) {
        searchInput.value = '';
      }
      clearSearch(document.querySelector('.search-input'), emojiContent);
    }
  }

  // 使用事件委托处理分类标签点击
  const emojiTabs = document.querySelector('.emoji-tabs');
  emojiTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) {
      const categoryName = tab.dataset.category;
      isClickScroll = true;
      updateActiveTab(categoryName);
      
      // 立即显示对应分类，不使用滚动动画
      const selectedCategory = emojiContent.querySelector(`[data-category="${categoryName}"]`);
      if (selectedCategory) {
        // 使用 scrollIntoView 方法，直接定位到目标位置，不使用动画
        selectedCategory.scrollIntoView({
            behavior: 'instant', 
            block: 'start'    
        });
      }
      
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

  // 修改：初始化表情分类标签
  function initEmojiTabs() {
    const emojiTabs = document.querySelector('.emoji-tabs');
    if (!emojiTabs) return;

    // 清空现有标签
    emojiTabs.innerHTML = '';
    
    // 创建所有分类的标签，常用表情放在最前面
    const categories = [
      { id: 'frequently', emoji: '🕒' }, // 使用时钟表情表示"常用"
      { id: 'smileys', emoji: '😀' },
      { id: 'animals', emoji: '🐱' },
      { id: 'food', emoji: '🍎' },
      { id: 'activity', emoji: '⚽' },
      { id: 'travel', emoji: '🚗' },
      { id: 'objects', emoji: '💡' },
      { id: 'symbols', emoji: '❤️' },
      { id: 'flags', emoji: '🏁' }
    ];

    categories.forEach(({ id, emoji }) => {
      const tab = document.createElement('div');
      tab.className = 'tab';
      tab.dataset.category = id;
      tab.setAttribute('title', chrome.i18n.getMessage(`emoji_category_${id}`));
      tab.textContent = emoji;
      
      // 默认激活常用表情标签
      if (id === 'frequently') {
        tab.classList.add('active');
      }
      
      emojiTabs.appendChild(tab);
    });
  }

  // 在适当的位置调用初始化函数
  initEmojiTabs();
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
            originalFaviconUrl: tabHistory[url].originalFaviconUrl,
            matchRule: tabHistory[url].matchRule || 'equals',
            customUrl: tabHistory[url].customUrl || url
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
            originalFaviconUrl: faviconResult.result || activeTab.favIconUrl,
            matchRule: 'equals',
            customUrl: url
        };
    } catch (error) {
        return {
            originalTitle: activeTab.title,
            originalFaviconUrl: activeTab.favIconUrl,
            matchRule: 'equals',
            customUrl: url
        };
    }
}