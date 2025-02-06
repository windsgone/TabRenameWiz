import emojiData from '../data/emojiData.js';

// 搜索状态管理
let isSearchMode = false;

/**
 * 搜索表情
 * @param {string} keyword - 搜索关键词
 * @returns {Object} 返回搜索结果
 */
export function searchEmojis(keyword) {
    const searchTerm = keyword?.toLowerCase().trim() || '';
    
    if (!searchTerm) {
        return {
            results: [],
            isEmpty: true
        };
    }

    const results = Object.entries(emojiData)
        .filter(([_, data]) => 
            data.keywords.some(kw => 
                kw.toLowerCase().includes(searchTerm)
            )
        )
        .map(([emoji, data]) => ({
            emoji,
            category: data.category
        }));

    return {
        results,
        isEmpty: results.length === 0
    };
}

/**
 * 构建搜索结果的HTML
 * @param {Array} results - 搜索结果
 * @returns {DocumentFragment}
 */
export function buildSearchResultsHTML(results) {
    const fragment = document.createDocumentFragment();
    const searchResultsDiv = document.createElement('div');
    searchResultsDiv.className = 'emoji-search-results';

    if (results.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results-message';
        noResultsDiv.textContent = chrome.i18n.getMessage('noEmojiFound');
        searchResultsDiv.appendChild(noResultsDiv);
    } else {
        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'emoji-grid';
        
        results.forEach(({emoji}) => {
            const emojiItem = document.createElement('div');
            emojiItem.className = 'emoji-item';
            emojiItem.textContent = emoji;
            emojiItem.dataset.emoji = emoji;
            emojiGrid.appendChild(emojiItem);
        });
        
        searchResultsDiv.appendChild(emojiGrid);
    }

    fragment.appendChild(searchResultsDiv);
    return fragment;
}

/**
 * 获取当前是否处于搜索模式
 */
export function isInSearchMode() {
    return isSearchMode;
}

/**
 * 设置搜索模式状态
 */
export function setSearchMode(status) {
    isSearchMode = status;
}

/**
 * 清空搜索
 */
export function clearSearch(searchInput, emojiContent) {
    searchInput.value = '';
    setSearchMode(false);
    // 恢复原始分类显示
    emojiContent.innerHTML = '';
    return true;
}
