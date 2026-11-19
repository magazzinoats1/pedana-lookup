// Extends app.json. WEB_EXPORT=1 builds the website version served by the backend at /api/app.
module.exports = ({ config }) =>
  process.env.WEB_EXPORT ? { ...config, experiments: { ...config.experiments, baseUrl: "/api/app" } } : config;
