/**
 * Builds and configure a Passport strategy to authenticate the proxy clients.
 */

import * as express from "express";
import { Either } from "fp-ts/lib/Either";
import * as passport from "passport-http-bearer";
import { IVerifyOptions } from "passport-http-bearer";
import { ISessionStorage } from "../services/ISessionStorage";
import { SessionToken } from "../types/token";
import { AppUser } from "../types/user";
import { log } from "../utils/logger";
/**
 * Passthrough a bearer token for specified paths.
 */
const bearerTokenStrategy = (sessionStorage: ISessionStorage) => {
  const options = {
    passReqToCallback: true,
    realm: "Proxy API",
    scope: "request"
  };
  return new passport.Strategy(options, (
    _: express.Request,
    token: string,
    // tslint:disable-next-line:no-any
    done: (error: any, user?: any, options?: IVerifyOptions | string) => void
  ) => {
    // req.route.path
    sessionStorage.getBySessionToken(token as SessionToken).then(
      (errorOrUser: Either<Error, AppUser>) => {
        log.debug("getBySessionToken %s", JSON.stringify(errorOrUser));
        errorOrUser.fold(
          () => done(undefined, false),
          user => done(undefined, user)
        );
      },
      () => {
        done(undefined, false);
      }
    );
  });
};

export default bearerTokenStrategy;
