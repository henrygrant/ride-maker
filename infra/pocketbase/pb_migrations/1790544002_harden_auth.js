migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = '@request.context = "oauth2"';
  users.passwordAuth.enabled = false;
  app.save(users);

  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "*:auth", audience: "", duration: 60, maxRequests: 10 },
    { label: "*:create", audience: "", duration: 60, maxRequests: 10 },
    { label: "/api/", audience: "", duration: 60, maxRequests: 300 },
  ];
  settings.trustedProxy.headers = ["CF-Connecting-IP"];
  settings.batch.enabled = false;
  app.save(settings);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "";
  users.passwordAuth.enabled = true;
  app.save(users);
});
