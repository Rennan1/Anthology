// Imports relativos ESM levam ".js"; o arquivo real é ".ts". Tenta o caminho como está (inclusive
// dentro de node_modules, ex.: openai) e só então sem a extensão.
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    if (/^\.{1,2}\//.test(request) && request.endsWith(".js")) {
      return options.defaultResolver(request.slice(0, -3), options);
    }
    throw error;
  }
};
