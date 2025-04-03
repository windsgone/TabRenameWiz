/**
 * URL匹配规则工具
 * 提供URL匹配规则相关的功能和UI操作
 */

// 匹配规则类型
const MATCH_RULES = {
  EQUALS: 'equals',
  STARTS_WITH: 'startsWith',
  ENDS_WITH: 'endsWith',
  CONTAINS: 'contains'
};

// 匹配规则的多语言文本键
const MATCH_RULE_I18N_KEYS = {
  [MATCH_RULES.EQUALS]: 'matchRuleEquals',
  [MATCH_RULES.STARTS_WITH]: 'matchRuleStartsWith',
  [MATCH_RULES.ENDS_WITH]: 'matchRuleEndsWith',
  [MATCH_RULES.CONTAINS]: 'matchRuleContains'
};

// 默认的多语言文本（当i18n不可用时）
const DEFAULT_I18N_TEXTS = {
  matchRuleEquals: 'is',
  matchRuleStartsWith: 'starts with',
  matchRuleEndsWith: 'ends with',
  matchRuleContains: 'contains',
  urlMatchRuleTitle: 'URL',
  urlMatchRuleExpand: 'Edit rule',
  urlMatchRuleCollapse: 'Collapse',
  urlMatchRuleCondition: 'Condition',
  urlMatchRuleAddress: 'URL address',
  urlMatchRuleMatched: 'Matched from rule',
  rulePriorityInfo: 'Higher priority rules will be applied first.'
};

/**
 * 获取匹配规则的显示文本
 * @param {string} rule 匹配规则
 * @returns {string} 匹配规则的显示文本
 */
function getMatchRuleText(rule) {
  const key = MATCH_RULE_I18N_KEYS[rule] || MATCH_RULE_I18N_KEYS[MATCH_RULES.EQUALS];
  return chrome.i18n.getMessage(key) || DEFAULT_I18N_TEXTS[key];
}

/**
 * 根据匹配规则检查URL是否匹配
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

/**
 * 创建URL匹配规则UI
 * @param {HTMLElement} container 容器元素
 * @param {Object} initialState 初始状态
 * @param {Function} onChange 状态变更回调
 * @returns {Object} 包含UI操作方法的对象
 */
function createUrlMatcherUI(container, initialState = {}, onChange = () => {}) {
  // 默认状态
  const state = {
    matchRule: initialState.matchRule || MATCH_RULES.EQUALS,
    customUrl: initialState.customUrl || '',
    expanded: false,
    isMatched: initialState.isMatched || false,
    currentUrl: initialState.currentUrl || '',
    ...initialState
  };

  // 创建UI元素
  const matcherContainer = document.createElement('div');
  matcherContainer.className = 'url-matcher';
  
  // 初始化UI
  updateUI();
  
  // 添加到容器
  container.prepend(matcherContainer);
  
  /**
   * 更新UI显示
   */
  function updateUI() {
    if (state.expanded) {
      // 展开状态
      matcherContainer.innerHTML = `
        <div class="url-matcher-header">
          <span data-i18n="urlMatchRuleTitle">${getI18nText('urlMatchRuleTitle')}</span>
          <button type="button" class="url-matcher-collapse">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
        </div>
        <div class="url-matcher-radio-group">
          ${Object.values(MATCH_RULES).map(rule => `
            <label class="url-matcher-radio ${state.matchRule === rule ? 'active' : ''}">
              <input type="radio" name="matchRule" value="${rule}" ${state.matchRule === rule ? 'checked' : ''}>
              <span data-i18n="${MATCH_RULE_I18N_KEYS[rule]}">${getMatchRuleText(rule)}</span>
            </label>
          `).join('')}
        </div>
        <div class="url-matcher-url">
          <input type="text" class="url-matcher-input" value="${state.customUrl}" placeholder="https://">
        </div>
        <div class="url-matcher-divider" style="width: 310px; height: 1px; background-color: #F8F8F8; margin: 15px auto;"></div>
      `;
      
      // 添加事件监听
      matcherContainer.querySelector('.url-matcher-collapse').addEventListener('click', collapse);
      
      // 添加单选按钮事件
      matcherContainer.querySelectorAll('input[name="matchRule"]').forEach(radio => {
        radio.addEventListener('change', function() {
          state.matchRule = this.value;
          updateRadioButtons();
          onChange(state);
        });
      });
      
      // 添加URL输入框事件
      const urlInput = matcherContainer.querySelector('.url-matcher-input');
      urlInput.addEventListener('input', function() {
        state.customUrl = this.value;
        onChange(state);
      });
      
    } else {
      // 收起状态
      matcherContainer.innerHTML = `
        <div class="url-matcher-collapsed">
          <span class="url-matcher-title" data-i18n="urlMatchRuleTitle">${getI18nText('urlMatchRuleTitle')}</span>
          <span class="url-matcher-rule" data-i18n="${MATCH_RULE_I18N_KEYS[state.matchRule]}">${getMatchRuleText(state.matchRule)}</span>
          <span class="url-matcher-value">${state.customUrl}</span>
          <button type="button" class="url-matcher-expand">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      `;
      
      // 添加事件监听
      matcherContainer.querySelector('.url-matcher-expand').addEventListener('click', expand);
    }
  }
  
  /**
   * 更新单选按钮状态
   */
  function updateRadioButtons() {
    matcherContainer.querySelectorAll('.url-matcher-radio').forEach(label => {
      const radio = label.querySelector('input');
      if (radio.value === state.matchRule) {
        label.classList.add('active');
      } else {
        label.classList.remove('active');
      }
    });
  }
  
  /**
   * 展开匹配规则UI
   */
  function expand() {
    state.expanded = true;
    updateUI();
  }
  
  /**
   * 收起匹配规则UI
   */
  function collapse() {
    state.expanded = false;
    updateUI();
  }
  
  /**
   * 获取i18n文本
   * @param {string} key i18n键
   * @returns {string} 文本
   */
  function getI18nText(key) {
    return chrome.i18n.getMessage(key) || DEFAULT_I18N_TEXTS[key];
  }
  
  /**
   * 设置匹配规则状态
   * @param {Object} newState 新状态
   */
  function setState(newState) {
    Object.assign(state, newState);
    updateUI();
  }
  
  /**
   * 获取当前状态
   * @returns {Object} 当前状态
   */
  function getState() {
    return { ...state };
  }
  
  // 返回操作接口
  return {
    expand,
    collapse,
    setState,
    getState,
    isMatched: (url) => isUrlMatched(url, state.customUrl, state.matchRule)
  };
}

// 导出模块
export {
  MATCH_RULES,
  getMatchRuleText,
  isUrlMatched,
  createUrlMatcherUI
};