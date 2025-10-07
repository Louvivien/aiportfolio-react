import { config } from "./config.js";
import { createApp } from "./app.js";

createApp()
  .then((app) => {
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`Backend listening on http://127.0.0.1:${config.port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start backend:", error);
    process.exit(1);
  });
