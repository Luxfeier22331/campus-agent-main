import type { ReactNode } from "react";

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import appStyles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "Campus Agent Public Consumer Chat",
      },
    ],
  }),
  component: RootLayout,
  notFoundComponent: PageNotFound,
});

function RootLayout() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument(props: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link href={appStyles} rel="stylesheet" />
      </head>
      <body className="app-root">
        <MotionConfig reducedMotion="user">
          {props.children}
          <Scripts />
        </MotionConfig>
      </body>
    </html>
  );
}

function PageNotFound() {
  return (
    <RootDocument>
      <main className="login-shell">
        <section className="login-card" aria-labelledby="not-found-title">
          <p className="eyebrow">404</p>
          <h1 id="not-found-title">Page not found</h1>
          <p className="lede">
            This route is outside the public consumer chat surface. Start a new chat
            or return to the login boundary.
          </p>
          <div className="history-group" style={{ marginTop: "24px" }}>
            <Link className="chat-send-button" to="/chat">
              Go to /chat
            </Link>
            <Link className="secondary-button" to="/login">
              Go to /login
            </Link>
          </div>
        </section>
      </main>
    </RootDocument>
  );
}
