migrate((app) => {
  const collection = app.findCollectionByNameOrId("routes");
  const users = app.findCollectionByNameOrId("users");

  // Existing shared routes have no owner and remain readable.
  collection.fields.add(new RelationField({
    name: "owner",
    collectionId: users.id,
    maxSelect: 1,
    required: false,
    cascadeDelete: false,
  }));
  collection.listRule = 'visibility = "public" || (@request.auth.id != "" && owner = @request.auth.id)';
  collection.viewRule = 'visibility = "public" || visibility = "unlisted" || (@request.auth.id != "" && owner = @request.auth.id)';
  collection.createRule = '@request.auth.id != "" && owner = @request.auth.id';
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("routes");
  collection.fields.removeByName("owner");
  collection.listRule = 'visibility = "public"';
  collection.viewRule = 'visibility = "public" || visibility = "unlisted"';
  collection.createRule = "";
  app.save(collection);
});
