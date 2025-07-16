import { SidebarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { ModeToggle } from "./mode-toggle";
import { useRouter, useCanGoBack } from "@tanstack/react-router";

export function SiteHeader() {
  const { toggleSidebar } = useSidebar();
  const router = useRouter();

  return (
    <header className="bg-background sticky top-0 z-50 flex w-full items-center border-b">
      <div
        className="flex h-(--header-height) w-full items-center gap-2 px-4 pl-[80px]"
        data-tauri-drag-region
      >
        <Button
          className="h-8 w-8"
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
        >
          <SidebarIcon />
        </Button>
        <Button
          className="h-8 w-8"
          variant="ghost"
          size="icon"
          onClick={() => {
            router.history.back();
          }}
          disabled={!useCanGoBack()}
        >
          <ChevronLeft />
        </Button>
        <Button
          className="h-8 w-8"
          variant="ghost"
          size="icon"
          onClick={() => {
            router.history.forward();
          }}
        >
          <ChevronRight />
        </Button>
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">Archestra</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Chats</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <ModeToggle />
    </header>
  );
}
