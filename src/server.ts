import * as bodyParser from "body-parser";
import * as express from "express";

import * as helmet from "helmet";
import * as http from "http";
import * as t from "io-ts";
import * as morgan from "morgan";
import * as passport from "passport";

import expressEnforcesSsl = require("express-enforces-ssl");
import proxy = require("express-http-proxy");

import { isLeft } from "fp-ts/lib/Either";
import { NodeEnvironmentEnum } from "italia-ts-commons/lib/environment";
import { toExpressHandler } from "italia-ts-commons/lib/express";

import {
  API_BASE_PATH,
  JSONAPI_BASE_URL,
  JWT_EXPIRES_IN,
  JWT_SECRET,
  NODE_ENVIRONMENT,
  SERVER_PORT,
  TOKEN_DURATION_IN_SECONDS
} from "./config";
import JwtService from "./services/jwt";
import RedisSessionStorage from "./services/redis_session_storage";
import bearerTokenStrategy from "./strategies/bearer_token";

import { getProfile } from "./controllers/profile";
import { AppUser } from "./types/user";
import { log } from "./utils/logger";
import { createSimpleRedisClient, DEFAULT_REDIS_PORT } from "./utils/redis";

const port = SERVER_PORT;
const env = NODE_ENVIRONMENT;

//
// Create Redis session storage
//

const redisClient = createSimpleRedisClient(
  parseInt(process.env.REDIS_PORT || DEFAULT_REDIS_PORT, 10),
  process.env.REDIS_URL!,
  process.env.REDIS_PASSWORD!
);

const sessionStorage = new RedisSessionStorage(
  redisClient,
  TOKEN_DURATION_IN_SECONDS
);

const bearerTokenAuth = passport.authenticate("bearer", { session: false });

//
//  Configure controllers and services
//
const jwtService = new JwtService(JWT_SECRET, JWT_EXPIRES_IN);

// Setup Passport.

// Add the strategy to authenticate proxy clients.
passport.use(bearerTokenStrategy(sessionStorage));

// Create and setup the Express app.
const app = express();

// Redirect unsecure connections.
if (env === NodeEnvironmentEnum.DEVELOPMENT) {
  // Trust proxy uses proxy X-Forwarded-Proto for ssl.
  app.enable("trust proxy");
  app.use(/\/((?!ping).)*/, expressEnforcesSsl());
}

// Add security to http headers.
app.use(helmet());

// Add a request logger.
const loggerFormat =
  ":date[iso] [info]: :method :url :status - :response-time ms";
app.use(morgan(loggerFormat));

// Parse the incoming request body.
app.use(
  bodyParser.json({
    type: ["application/json", "application/vnd.api+json"]
  })
);

// Parse an urlencoded body.
app.use(bodyParser.urlencoded({ extended: true }));

// Define the folder that contains the public assets.
app.use(express.static("public"));

// Initializes Passport for incoming requests.
app.use(passport.initialize());

// Setup routing.
app.get("/login", (_, res) => res.json({ TODO: "TODO" }));

app.get(
  `${API_BASE_PATH}/profile`,
  bearerTokenAuth,
  (req: express.Request, res: express.Response) => {
    toExpressHandler(getProfile)(req, res);
  }
);

// tslint:disable-next-line: no-var-requires
const packageJson = require("../package.json");
const version = t.string.decode(packageJson.version).getOrElse("UNKNOWN");

app.get("/info", (_, res) => {
  res.status(200).json({ version });
});

// Liveness probe for Kubernetes.
// @see
// https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#define-a-liveness-http-request
app.get("/ping", (_, res) => res.status(200).send("ok"));

// Setup proxy
app.use(
  "/proxy",
  bearerTokenAuth,
  proxy(JSONAPI_BASE_URL, {
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      // srcReq.user is set by bearerTokenAuth
      const errorOrUser = AppUser.decode(srcReq.user);
      if (isLeft(errorOrUser)) {
        return proxyReqOpts;
      }
      const user = errorOrUser.value;
      if (!user.metadata || !user.metadata.uid) {
        return proxyReqOpts;
      }
      const jwt = jwtService.getJwtForUid(parseInt(user.metadata.uid, 10));
      return {
        ...proxyReqOpts,
        headers: { ...proxyReqOpts.headers, Authorization: "Bearer " + jwt }
      };
    }
  })
);

//
//  Start HTTP server
//

// HTTPS is terminated by the Kubernetes Ingress controller.
http.createServer(app).listen(port, () => {
  log.info("Listening on port %d", port);
});
