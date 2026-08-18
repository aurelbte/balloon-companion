# Controlled Cloud Sync test

This diagnostic mode exists only in a development build. It is not a user
preference and stores no flag.

1. Start the application in development mode and open it with
   `?cloudSyncTest=targeted` before signing in or opening the authenticated app.
2. Confirm that `window.__BC_CLOUD_SYNC_CONTROLLED_TEST__` exists. In this mode,
   startup, online, and mutation events cannot launch the global outbox pass.
3. Create the temporary Weather favorite through the normal application UI.
4. Read its `mutationId` from the scoped IndexedDB outbox using browser developer
   tooling, without editing the outbox.
5. Invoke only
   `window.__BC_CLOUD_SYNC_CONTROLLED_TEST__.syncMutationById(mutationId)`.
6. Repeat the targeted call for the DELETE mutation created through the normal UI.
7. Remove `?cloudSyncTest=targeted` or close the development tab after the test.

Production builds ignore the query parameter and never expose the diagnostic API.
