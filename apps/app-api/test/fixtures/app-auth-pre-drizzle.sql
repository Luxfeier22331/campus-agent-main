--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "app_auth";


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: account; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."account" (
    "id" "text" NOT NULL,
    "accountId" "text" NOT NULL,
    "providerId" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "accessToken" "text",
    "refreshToken" "text",
    "idToken" "text",
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    "scope" "text",
    "password" "text",
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: jwks; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."jwks" (
    "id" "text" NOT NULL,
    "publicKey" "text" NOT NULL,
    "privateKey" "text" NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone
);


--
-- Name: oauthAccessToken; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."oauthAccessToken" (
    "id" "text" NOT NULL,
    "token" "text" NOT NULL,
    "clientId" "text" NOT NULL,
    "sessionId" "text",
    "userId" "text",
    "referenceId" "text",
    "refreshId" "text",
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "scopes" "jsonb" NOT NULL
);


--
-- Name: oauthClient; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."oauthClient" (
    "id" "text" NOT NULL,
    "clientId" "text" NOT NULL,
    "clientSecret" "text",
    "disabled" boolean,
    "skipConsent" boolean,
    "enableEndSession" boolean,
    "subjectType" "text",
    "scopes" "jsonb",
    "userId" "text",
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    "name" "text",
    "uri" "text",
    "icon" "text",
    "contacts" "jsonb",
    "tos" "text",
    "policy" "text",
    "softwareId" "text",
    "softwareVersion" "text",
    "softwareStatement" "text",
    "redirectUris" "jsonb" NOT NULL,
    "postLogoutRedirectUris" "jsonb",
    "tokenEndpointAuthMethod" "text",
    "grantTypes" "jsonb",
    "responseTypes" "jsonb",
    "public" boolean,
    "type" "text",
    "requirePKCE" boolean,
    "referenceId" "text",
    "metadata" "jsonb"
);


--
-- Name: oauthConsent; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."oauthConsent" (
    "id" "text" NOT NULL,
    "clientId" "text" NOT NULL,
    "userId" "text",
    "referenceId" "text",
    "scopes" "jsonb" NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: oauthRefreshToken; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."oauthRefreshToken" (
    "id" "text" NOT NULL,
    "token" "text" NOT NULL,
    "clientId" "text" NOT NULL,
    "sessionId" "text",
    "userId" "text" NOT NULL,
    "referenceId" "text",
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "revoked" timestamp with time zone,
    "authTime" timestamp with time zone,
    "scopes" "jsonb" NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."session" (
    "id" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "token" "text" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" "text",
    "userAgent" "text",
    "userId" "text" NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."user" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "emailVerified" boolean NOT NULL,
    "image" "text",
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "role" "text",
    "banned" boolean,
    "banReason" "text",
    "banExpires" timestamp with time zone
);


--
-- Name: verification; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE "app_auth"."verification" (
    "id" "text" NOT NULL,
    "identifier" "text" NOT NULL,
    "value" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."account"
    ADD CONSTRAINT "account_pkey" PRIMARY KEY ("id");


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."jwks"
    ADD CONSTRAINT "jwks_pkey" PRIMARY KEY ("id");


--
-- Name: oauthAccessToken oauthAccessToken_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY ("id");


--
-- Name: oauthAccessToken oauthAccessToken_token_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_token_key" UNIQUE ("token");


--
-- Name: oauthClient oauthClient_clientId_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthClient"
    ADD CONSTRAINT "oauthClient_clientId_key" UNIQUE ("clientId");


--
-- Name: oauthClient oauthClient_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthClient"
    ADD CONSTRAINT "oauthClient_pkey" PRIMARY KEY ("id");


--
-- Name: oauthConsent oauthConsent_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthConsent"
    ADD CONSTRAINT "oauthConsent_pkey" PRIMARY KEY ("id");


--
-- Name: oauthRefreshToken oauthRefreshToken_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY ("id");


--
-- Name: oauthRefreshToken oauthRefreshToken_token_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_token_key" UNIQUE ("token");


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."session"
    ADD CONSTRAINT "session_pkey" PRIMARY KEY ("id");


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."session"
    ADD CONSTRAINT "session_token_key" UNIQUE ("token");


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."user"
    ADD CONSTRAINT "user_email_key" UNIQUE ("email");


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."user"
    ADD CONSTRAINT "user_pkey" PRIMARY KEY ("id");


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."verification"
    ADD CONSTRAINT "verification_pkey" PRIMARY KEY ("id");


--
-- Name: account_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "account_userId_idx" ON "app_auth"."account" USING "btree" ("userId");


--
-- Name: oauthAccessToken_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_clientId_idx" ON "app_auth"."oauthAccessToken" USING "btree" ("clientId");


--
-- Name: oauthAccessToken_refreshId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_refreshId_idx" ON "app_auth"."oauthAccessToken" USING "btree" ("refreshId");


--
-- Name: oauthAccessToken_sessionId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_sessionId_idx" ON "app_auth"."oauthAccessToken" USING "btree" ("sessionId");


--
-- Name: oauthAccessToken_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_userId_idx" ON "app_auth"."oauthAccessToken" USING "btree" ("userId");


--
-- Name: oauthClient_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthClient_userId_idx" ON "app_auth"."oauthClient" USING "btree" ("userId");


--
-- Name: oauthConsent_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthConsent_clientId_idx" ON "app_auth"."oauthConsent" USING "btree" ("clientId");


--
-- Name: oauthConsent_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthConsent_userId_idx" ON "app_auth"."oauthConsent" USING "btree" ("userId");


--
-- Name: oauthRefreshToken_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_clientId_idx" ON "app_auth"."oauthRefreshToken" USING "btree" ("clientId");


--
-- Name: oauthRefreshToken_sessionId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "app_auth"."oauthRefreshToken" USING "btree" ("sessionId");


--
-- Name: oauthRefreshToken_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_userId_idx" ON "app_auth"."oauthRefreshToken" USING "btree" ("userId");


--
-- Name: session_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "session_userId_idx" ON "app_auth"."session" USING "btree" ("userId");


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "verification_identifier_idx" ON "app_auth"."verification" USING "btree" ("identifier");


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."account"
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_clientId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_refreshId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "app_auth"."oauthRefreshToken"("id") ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_sessionId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "app_auth"."session"("id") ON DELETE SET NULL;


--
-- Name: oauthAccessToken oauthAccessToken_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- Name: oauthClient oauthClient_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthClient"
    ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- Name: oauthConsent oauthConsent_clientId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthConsent"
    ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthConsent oauthConsent_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthConsent"
    ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- Name: oauthRefreshToken oauthRefreshToken_clientId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthRefreshToken oauthRefreshToken_sessionId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "app_auth"."session"("id") ON DELETE SET NULL;


--
-- Name: oauthRefreshToken oauthRefreshToken_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY "app_auth"."session"
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
