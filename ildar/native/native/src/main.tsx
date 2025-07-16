import React from "react";
import ReactDOM from "react-dom/client";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import "./index.css";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import "./index.css";
import { SiteHeader } from "@/components/site-header";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import ChatPage from "./ChatPage";

const rootRoute = createRootRoute({
  component: () => (
    <div className="[--header-height:calc(--spacing(9))] h-screen flex flex-col">
      <SidebarProvider className="flex flex-col flex-1">
        <SiteHeader />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <SidebarInset className="overflow-auto">
            <Outlet />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function Index() {
    return <ChatPage></ChatPage>;
  },
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/catalog",
  component: function About() {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid auto-rows-min gap-4 md:grid-cols-3">
          {[...Array(40)].map(() => (
            <div className="bg-muted/50 aspect-video rounded-xl" />
          ))}
        </div>
      </div>
    );
  },
});

const runtimeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runtime",
  component: function About() {
    return <App></App>;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  catalogRoute,
  runtimeRoute,
]);

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <RouterProvider router={router} />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
