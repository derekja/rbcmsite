// config-overrides.js
module.exports = function override(config, env) {
  // Disable all HMR and WebSocket functionality for webpack-dev-server
  if (env === 'development') {
    // Find the webpack-dev-server entry point and remove it
    if (config.entry) {
      const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
      config.entry = entries.filter(entry => {
        return typeof entry === 'string' && 
               !entry.includes('webpack-dev-server') && 
               !entry.includes('webpack/hot/dev-server');
      });
    }
    
    // Disable hot module replacement plugin
    if (config.plugins) {
      config.plugins = config.plugins.filter(plugin => {
        return !plugin.constructor.name.includes('HotModuleReplacement') &&
               !plugin.constructor.name.includes('ReactRefreshPlugin');
      });
    }
    
    // Disable WebSocket for webpack-dev-server
    if (!config.devServer) config.devServer = {};
    config.devServer.hot = false;
    config.devServer.liveReload = false;
    config.devServer.webSocketServer = false;
  }
  
  return config;
};