let scrollListenerEnabled = true;
let scrollTimeout;
let isClickScroll = false;

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
  const tabs = document.querySelectorAll('.emoji-tabs .tab');
  const emojiContent = document.querySelector('.emoji-content');
  
  // 确保元素存在
  if (!faviconBox || !emojiPicker || !currentFavicon) {
    console.error('Required elements not found:', {
      faviconBox: !!faviconBox,
      emojiPicker: !!emojiPicker,
      currentFavicon: !!currentFavicon
    });
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
    }
  });

  // 获取当前标签页的 favicon
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const activeTab = tabs[0];
    // 检查是否有自定义 favicon
    chrome.storage.local.get(['faviconHistory'], function(result) {
      const history = result.faviconHistory || {};
      if (history[activeTab.url] && history[activeTab.url].emoji) {
        // 如果是 emoji，使用 div 显示
        currentFavicon.style.display = 'none';
        faviconBox.innerHTML = `<div class="emoji-favicon">${history[activeTab.url].emoji}</div>`;
      } else {
        // 如果是普通图片，使用 img 显示
        currentFavicon.style.display = 'block';
        currentFavicon.src = activeTab.favIconUrl || '';
        faviconBox.querySelector('.emoji-favicon')?.remove();
      }
    });
  });


  // 初始化表情选择器
  function initEmojiPicker() {
    // 默认显示第一个分类
    showEmojiCategory('smileys');
    
    // 修改tab点击事件处理
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const categoryName = tab.dataset.category;
        // 设置标志
        isClickScroll = true;
        // 立即更新 UI
        updateActiveTab(categoryName);
        
        const categoryElement = emojiContent.querySelector(`[data-category="${categoryName}"]`);
        if (categoryElement) {
          categoryElement.scrollIntoView({ behavior: 'smooth' });
          
          // 等待滚动动画完成后重置状态
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            isClickScroll = false;
          }, 500);
        }
      });
    });
  }

  function showEmojiCategory(categoryName) {
    const emojiContent = document.querySelector('.emoji-content');
    const categories = {
        'smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🫣', '🤗', '🫡', '🤔', '🫢', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🫨', '🫠', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '😵‍💫', '🫥', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
        'animals': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷', '🕸', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🪸', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿', '🦔'],
        'food': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽', '🥢', '🥡'],
        'activity': ['⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳️', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸', '🥌', '🎿', '⛷', '🏂', '🪂', '🏋️‍♀️', '🏋️', '🏋️‍♂️', '🤼‍♀️', '🤼', '🤼‍♂️', '🤸‍♀️', '🤸', '🤸‍♂️', '⛹️‍♀️', '⛹️', '⛹️‍♂️', '🤺', '🤾‍♀️', '🤾', '🤾‍♂️', '🏌️‍♀️', '🏌️', '🏌️‍♂️', '🏇', '🧘‍♀️', '🧘', '🧘‍♂️', '🏄‍♀️', '🏄', '🏄‍♂️', '🏊‍♀️', '🏊', '🏊‍♂️', '🤽‍♀️', '🤽', '🤽‍♂️', '🚣‍♀️', '🚣', '🚣‍♂️', '🧗‍♀️', '🧗', '🧗‍♂️', '🚵‍♀️', '🚵', '🚵‍♂️', '🚴‍♀️', '🚴', '🚴‍♂️', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎪', '🤹‍♀️', '🤹', '🤹‍♂️', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩'],
        'travel': ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩', '💺', '🛰', '🚀', '🛸', '🚁', '🛶', '⛵️', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓️', '🪝', '⛽️', '🚧', '🚦', '🚥', '🚏', '🗺', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟', '🎡', '🎢', '🎠', '⛲️', '⛱', '🏖', '🏝', '🏜', '🌋', '⛰', '🏔', '🗻', '🏕', '⛺️', '🏠', '🏡', '🏘', '🏚', '🏗', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏩', '💒', '🏛', '⛪️', '🕌', '🕍', '🛕', '🕋', '⛩', '🛤', '🛣', '🗾', '🎑', '🏞', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙', '🌃', '🌌', '🌉', '🌁'],
        'objects': ['⌚️', '📱', '📲', '💻', '⌨️', '🖥', '🖨', '🖱', '🖲', '🕹', '🗜', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙', '🎚', '🎛', '🧭', '⏱', '⏲', '⏰', '🕰', '⌛️', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯', '🪔', '🧯', '🛢', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒', '🛠', '⛏', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡', '⚔️', '🛡', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎', '🔑', '🗝', '🚪', '🪑', '🛋', '🛏', '🛌', '🧸', '🪆', '🖼', '🪞', '🪟', '🛍', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒', '🗓', '📆', '📅', '🗑', '📇', '🗃', '🗳', '🗄', '📋', '📁', '📂', '🗂', '🗞', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊', '🖋', '✒️', '🖌', '🖍', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'],
        'symbols': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '❤️‍🔥', '❤️‍🩹', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈️', '♉️', '♊️', '♋️', '♌️', '♍️', '♎️', '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯️', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿️', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫️', '⚪️', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾️', '◽️', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛️', '⬜️', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄️', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'],
        'flags': ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇨', '🇦🇩', '🇦🇪', '🇦🇫', '🇦🇬', '🇦🇮', '🇦🇱', '🇦🇲', '🇦🇴', '🇦🇶', '🇦🇷', '🇦🇸', '🇦🇹', '🇦🇺', '🇦🇼', '🇦🇽', '🇦🇿', '🇧🇦', '🇧🇧', '🇧🇩', '🇧🇪', '🇧🇫', '🇧🇬', '🇧🇭', '🇧🇮', '🇧🇯', '🇧🇱', '🇧🇲', '🇧🇳', '🇧🇴', '🇧🇶', '🇧🇷', '🇧🇸', '🇧🇹', '🇧🇻', '🇧🇼', '🇧🇾', '🇧🇿', '🇨🇦', '🇨🇨', '🇨🇩', '🇨🇫', '🇨🇬', '🇨🇭', '🇨🇮', '🇨🇰', '🇨🇱', '🇨🇲', '🇨🇳', '🇨🇴', '🇨🇵', '🇨🇷', '🇨🇺', '🇨🇻', '🇨🇼', '🇨🇽', '🇨🇾', '🇨🇿', '🇩🇪', '🇩🇬', '🇩🇯', '🇩🇰', '🇩🇲', '🇩🇴', '🇩🇿', '🇪🇦', '🇪🇨', '🇪🇪', '🇪🇬', '🇪🇭', '🇪🇷', '🇪🇸', '🇪🇹', '🇪🇺', '🇫🇮', '🇫🇯', '🇫🇰', '🇫🇲', '🇫🇴', '🇫🇷', '🇬🇦', '🇬🇧', '🇬🇩', '🇬🇪', '🇬🇫', '🇬🇬', '🇬🇭', '🇬🇮', '🇬🇱', '🇬🇲', '🇬🇳', '🇬🇵', '🇬🇶', '🇬🇷', '🇬🇸', '🇬🇹', '🇬🇺', '🇬🇼', '🇬🇾', '🇭🇰', '🇭🇲', '🇭🇳', '🇭🇷', '🇭🇹', '🇭🇺', '🇮🇨', '🇮🇩', '🇮🇪', '🇮🇱', '🇮🇲', '🇮🇳', '🇮🇴', '🇮🇶', '🇮🇷', '🇮🇸', '🇮🇹', '🇯🇪', '🇯🇲', '🇯🇴', '🇯🇵', '🇰🇪', '🇰🇬', '🇰🇭', '🇰🇮', '🇰🇲', '🇰🇳', '🇰🇵', '🇰🇷', '🇰🇼', '🇰🇾', '🇰🇿', '🇱🇦', '🇱🇧', '🇱🇨', '🇱🇮', '🇱🇰', '🇱🇷', '🇱🇸', '🇱🇹', '🇱🇺', '🇱🇻', '🇱🇾', '🇲🇦', '🇲🇨', '🇲🇩', '🇲🇪', '🇲🇫', '🇲🇬', '🇲🇭', '🇲🇰', '🇲🇱', '🇲🇲', '🇲🇳', '🇲🇴', '🇲🇵', '🇲🇶', '🇲🇷', '🇲🇸', '🇲🇹', '🇲🇺', '🇲🇻', '🇲🇼', '🇲🇽', '🇲🇾', '🇲🇿', '🇳🇦', '🇳🇨', '🇳🇪', '🇳🇫', '🇳🇬', '🇳🇮', '🇳🇱', '🇳🇴', '🇳🇵', '🇳🇷', '🇳🇺', '🇳🇿', '🇴🇲', '🇵🇦', '🇵🇪', '🇵🇫', '🇵🇬', '🇵🇭', '🇵🇰', '🇵🇱', '🇵🇲', '🇵🇳', '🇵🇷', '🇵🇸', '🇵🇹', '🇵🇼', '🇵🇾', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇸', '🇷🇺', '🇷🇼', '🇸🇦', '🇸🇧', '🇸🇨', '🇸🇩', '🇸🇪', '🇸🇬', '🇸🇭', '🇸🇮', '🇸🇯', '🇸🇰', '🇸🇱', '🇸🇲', '🇸🇳', '🇸🇴', '🇸🇷', '🇸🇸', '🇸🇹', '🇸🇻', '🇸🇽', '🇸🇾', '🇸🇿', '🇹🇦', '🇹🇨', '🇹🇩', '🇹🇫', '🇹🇬', '🇹🇭', '🇹🇯', '🇹🇰', '🇹🇱', '🇹🇲', '🇹🇳', '🇹🇴', '🇹🇷', '🇹🇹', '🇹🇻', '🇹🇼', '🇹🇿', '🇺🇦', '🇺🇬', '🇺🇲', '🇺🇳', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇦', '🇻🇨', '🇻🇪', '🇻🇬', '🇻🇮', '🇻🇳', '🇻🇺', '🇼🇫', '🇼🇸', '🇽🇰', '🇾🇪', '🇾🇹', '🇿🇦', '🇿🇲', '🇿🇼', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿']
    };

    // 清空内容区域
    emojiContent.innerHTML = '';

    // 创建并显示所有分类
    Object.entries(categories).forEach(([category, emojis]) => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'emoji-category';
        categoryDiv.dataset.category = category;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'category-title';
        titleDiv.textContent = chrome.i18n.getMessage(`emoji_category_${category}`);
        categoryDiv.appendChild(titleDiv);

        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'emoji-grid';

        emojis.forEach(emoji => {
            const emojiItem = document.createElement('div');
            emojiItem.className = 'emoji-item';
            emojiItem.textContent = emoji;
            emojiItem.addEventListener('click', () => {
                // 移除现有的 emoji-favicon
                faviconBox.querySelector('.emoji-favicon')?.remove();
                
                // 隐藏原始的 img 标签
                currentFavicon.style.display = 'none';
                
                // 创建新的 emoji favicon
                const emojiFavicon = document.createElement('div');
                emojiFavicon.className = 'emoji-favicon';
                emojiFavicon.textContent = emoji;
                faviconBox.appendChild(emojiFavicon);

                // 隐藏 emoji picker
                hideEmojiPicker();
            });
            emojiGrid.appendChild(emojiItem);
        });

        categoryDiv.appendChild(emojiGrid);
        emojiContent.appendChild(categoryDiv);
    });

    // 更新选中的标签样式
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        if (tab.dataset.category === categoryName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
  }

  function selectEmoji(emoji) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const activeTab = tabs[0];
        
        chrome.storage.local.get(['faviconHistory'], function(result) {
            const faviconHistory = result.faviconHistory || {};
            
            // 更新 favicon 历史
            faviconHistory[activeTab.url] = {
                emoji: emoji,
                url: activeTab.url,
                timestamp: new Date().getTime()
            };
            
            // 保存到 storage
            chrome.storage.local.set({ faviconHistory: faviconHistory }, function() {
                // 更新显示
                currentFavicon.style.display = 'none';
                faviconBox.querySelector('.emoji-favicon')?.remove();
                faviconBox.innerHTML = `<div class="emoji-favicon">${emoji}</div>`;
                hideEmojiPicker();
                
                // 显示保存按钮
                document.querySelector('button[type="submit"]').style.display = 'block';
            });
        });
    });
  }

  function showEmojiPicker() {
    emojiPicker.style.display = 'block';
  }

  function hideEmojiPicker() {
    if (emojiPicker) {
        emojiPicker.style.display = 'none';
        // 移除高亮状态
        document.getElementById('faviconBox').classList.remove('active');
    }
    
    const submitButton = document.querySelector('button[type="submit"]');
    if (submitButton) {
        const hasFaviconContent = currentFavicon && currentFavicon.src;
        const hasEmojiFavicon = document.querySelector('.emoji-favicon') !== null;
        
        if (hasFaviconContent || hasEmojiFavicon) {
            submitButton.style.display = 'block';
        }
    }
  }

  // 初始化表情选择器
  initEmojiPicker();

  // 立即加载第一个分类的表情
  showEmojiCategory('smileys');

  // 点击其他区域关闭表情选择器
  document.addEventListener('click', function(event) {
    const isClickInside = faviconBox.contains(event.target) || 
                         emojiPicker.contains(event.target);
    if (!isClickInside) {
      hideEmojiPicker();
    }
  });

  // 监听滚动事件来更新分类标签的激活状态
  let lastScrollTime = 0;
  let lastActiveCategory = null;
  const SCROLL_THROTTLE = 100; // 100ms 的节流时间

  // 修改滚动事件处理
  emojiContent.addEventListener('scroll', function() {
    // 如果是点击触发的滚动，直接返回
    if (isClickScroll) {
        return;
    }
    
    const now = Date.now();
    if (now - lastScrollTime < SCROLL_THROTTLE) {
        return;
    }
    lastScrollTime = now;
    
    // 获取当前可视区域中的分类
    const categories = emojiContent.querySelectorAll('.emoji-category');
    let newActiveCategory = null;
    
    // 获取滚动容器的位置信息
    const containerRect = emojiContent.getBoundingClientRect();
    const containerTop = containerRect.top;
    
    // 遍历所有分类，找到第一个在视口中的分类
    for (const category of categories) {
        const rect = category.getBoundingClientRect();
        const relativeTop = rect.top - containerTop;
        
        if (relativeTop <= 10) {
            newActiveCategory = category.dataset.category;
        } else {
            break;
        }
    }

    if (newActiveCategory && newActiveCategory !== lastActiveCategory) {
        lastActiveCategory = newActiveCategory;
        updateActiveTab(newActiveCategory);
    }
  });

  function updateActiveTab(categoryName) {
    tabs.forEach(tab => {
      if (tab.dataset.category === categoryName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }
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