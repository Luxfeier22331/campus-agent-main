CREATE TABLE "app_auth"."oauthClientAssertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_auth"."oauthClientResource" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"resourceId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_auth"."oauthResource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"allowedScopes" jsonb,
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD COLUMN "authorizationCodeId" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD COLUMN "resources" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD COLUMN "requestedUserInfoClaims" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD COLUMN "revoked" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "clientDiscoveryId" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "clientCredentialsScopes" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "backchannelLogoutUri" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "backchannelLogoutSessionRequired" boolean;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "applicationType" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "jwks" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "jwksUri" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD COLUMN "dpopBoundAccessTokens" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" ADD COLUMN "resources" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" ADD COLUMN "requestedUserInfoClaims" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "authorizationCodeId" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "resources" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "requestedUserInfoClaims" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "rotatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "rotationReplayResponse" text;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "rotationReplayExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES "app_auth"."oauthResource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "app_auth"."oauthClientResource" USING btree ("clientId","resourceId");--> statement-breakpoint
CREATE INDEX "oauthClientResource_clientId_idx" ON "app_auth"."oauthClientResource" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthClientResource_resourceId_idx" ON "app_auth"."oauthClientResource" USING btree ("resourceId");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthResource_identifier_uidx" ON "app_auth"."oauthResource" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "app_auth"."oauthAccessToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "app_auth"."oauthRefreshToken" USING btree ("authorizationCodeId");
