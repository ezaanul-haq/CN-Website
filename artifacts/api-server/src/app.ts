import express, { type Express } from "express";
import type { ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof error.status === "number"
        ? error.status
        : 500;
  const message =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.message === "string"
      ? error.message
      : statusCode === 413
        ? "The request is too large."
        : statusCode === 400
          ? "The request body is invalid."
          : "The request could not be completed.";
  const errorName =
    error instanceof Error ? error.name : "UnknownError";
  logger.error({ statusCode, errorName }, "API request failed");
  if (!response.headersSent) {
    response.status(statusCode).json({ error: message });
  }
};

app.use(errorHandler);

export default app;
