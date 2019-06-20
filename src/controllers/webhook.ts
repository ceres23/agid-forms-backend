import * as express from "express";

import {
  IResponseErrorForbiddenNotAuthorized,
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseSuccessJson
} from "italia-ts-commons/lib/responses";

import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "../middlewares/request_middleware";
import { UserFromRequestMiddleware } from "../middlewares/user_from_request";

import { GraphqlClient, UPSERT_USER } from "../clients/graphql";

import { isLeft } from "fp-ts/lib/Either";
import { UUIDString } from "../generated/api/UUIDString";
import { user_role_constraint } from "../generated/graphql/globalTypes";
import {
  UpsertUser,
  UpsertUserVariables
} from "../generated/graphql/UpsertUser";
import { HasuraJwtService } from "../services/jwt";
import { AppUser } from "../types/user";

type UserMetadataT = Record<string, string>;

type AuthWebhookT = (
  user: AppUser
) => Promise<
  // tslint:disable-next-line: max-union-size
  | IResponseErrorInternal
  | IResponseErrorValidation
  | IResponseErrorNotFound
  | IResponseErrorForbiddenNotAuthorized
  | IResponseSuccessJson<UserMetadataT>
>;

function AuthWebhookHandler(
  graphqlClient: GraphqlClient,
  hasuraJwtService: ReturnType<HasuraJwtService>
): AuthWebhookT {
  return async user => {
    // Upsert user into graphql database
    const errorOrUpsertResult = await graphqlClient.mutate<
      UpsertUser,
      UpsertUserVariables
    >({
      mutation: UPSERT_USER,
      variables: {
        user: {
          email: user.email,
          metadata: user.metadata,
          user_roles: {
            data: user.roles.map(role => ({
              role_id: role
            })),
            on_conflict: {
              constraint: user_role_constraint.user_role_pkey,
              update_columns: []
            }
          }
        }
      }
    });

    if (errorOrUpsertResult.errors) {
      return ResponseErrorInternal(errorOrUpsertResult.errors.join("\n"));
    }
    if (!errorOrUpsertResult.data) {
      return ResponseErrorInternal("Cannot upsert user.");
    }
    const upsertResult = errorOrUpsertResult.data;
    if (!upsertResult.insert_user || !upsertResult.insert_user.returning[0]) {
      return ResponseErrorInternal("Cannot get data from upserted user.");
    }

    // Get user uuid and put it into JWT
    const errorOrUserUuid = UUIDString.decode(
      upsertResult.insert_user.returning[0].id
    );
    if (isLeft(errorOrUserUuid)) {
      return ResponseErrorInternal("Cannot get UUID from upserted user.");
    }
    const userUuid = errorOrUserUuid.value;

    // Generate hasura jwt and serve it with metadata
    const jwt = hasuraJwtService.getJwtForUser(
      user.email,
      userUuid,
      user.name,
      user.roles
    );

    return ResponseSuccessJson({
      id: userUuid,
      jwt
    });
  };
}

export function AuthWebhook(
  graphqlClient: GraphqlClient,
  hasuraJwtService: ReturnType<HasuraJwtService>
): express.RequestHandler {
  const handler = AuthWebhookHandler(graphqlClient, hasuraJwtService);
  const withrequestMiddlewares = withRequestMiddlewares(
    UserFromRequestMiddleware(AppUser)
  );
  return wrapRequestHandler(withrequestMiddlewares(handler));
}
