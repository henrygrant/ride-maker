migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "routes",
    // Public routes are discoverable; unlisted routes are accessible only by id.
    listRule: 'visibility = "public"',
    viewRule: 'visibility = "public" || visibility = "unlisted"',
    // Anonymous creation is useful for the first sharing MVP. Updates and deletes
    // remain locked until we add users or an edit-token flow.
    createRule: "",
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "name",
        type: "text",
        required: true,
        max: 200,
      },
      {
        name: "slug",
        type: "text",
        required: true,
        min: 8,
        max: 64,
        pattern: "^[a-zA-Z0-9_-]+$",
      },
      {
        name: "visibility",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["unlisted", "public", "private"],
      },
      {
        name: "document",
        type: "json",
        required: true,
        maxSize: 2097152,
      },
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      },
      {
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_routes_slug ON routes (slug)",
      "CREATE INDEX idx_routes_visibility_created ON routes (visibility, created)",
    ],
  });

  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("routes"));
});
