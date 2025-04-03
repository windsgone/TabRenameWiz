/**
 * 主题检测器 - 用于检测浏览器的暗色模式设置并在变化时通知
 */
export function initThemeDetector() {
  // 检查浏览器是否支持 prefers-color-scheme
  if (window.matchMedia) {
    // 创建媒体查询
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // 初始检查
    handleThemeChange(darkModeMediaQuery);
    
    // 监听变化
    try {
      // 新版浏览器使用 addEventListener
      darkModeMediaQuery.addEventListener('change', handleThemeChange);
    } catch (e1) {
      try {
        // 旧版浏览器使用 addListener
        darkModeMediaQuery.addListener(handleThemeChange);
      } catch (e2) {
        console.error('浏览器不支持暗色模式变化监听', e2);
      }
    }
  }
}

/**
 * 处理主题变化
 * @param {MediaQueryListEvent|MediaQueryList} event 媒体查询事件或对象
 */
function handleThemeChange(event) {
  const isDarkMode = event.matches;
  
  // 触发自定义事件，通知应用主题已更改
  document.dispatchEvent(new CustomEvent('themeChanged', { 
    detail: { isDarkMode } 
  }));
  
  // 记录主题变化到控制台（调试用）
  console.log(`主题已更改为: ${isDarkMode ? '暗色模式' : '浅色模式'}`);
}
