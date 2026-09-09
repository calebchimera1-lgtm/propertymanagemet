'use client';

import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Breadcrumbs } from './breadcrumbs';
import { SidebarNav } from './sidebar';
import { UserMenu } from './user-menu';

export function Topbar() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      {/* Mobile navigation is a slide-over panel, not a squeezed sidebar. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" title="Navigation">
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}
