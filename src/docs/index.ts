import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./openapi.js";

export function mountApiDocs(app: Express) {
  app.get("/api-docs.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Hotel PMS API Docs",
      customCss: ".swagger-ui .topbar { display: none }",
      swaggerOptions: {
        docExpansion: "none",
        filter: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
        tryItOutEnabled: true,
        persistAuthorization: true,
      },
    }),
  );
}
