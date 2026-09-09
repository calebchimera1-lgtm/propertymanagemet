'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authApi } from '@/features/auth/api';
import { useSession } from '@/features/auth/use-session';
import { initialsOf } from '@/lib/utils';

export function UserMenu() {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      // Clear every cached response: the next user of this browser must not see
      // the previous one's data from cache.
      queryClient.clear();
      router.replace('/login');
    },
    onError: () => toast.error('Could not sign out. Please try again.'),
  });

  if (!me) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <Avatar>
            <AvatarFallback>{initialsOf(me.user.fullName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold">{me.user.fullName}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {me.user.email}
          </span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {me.roles.join(', ')}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/profile')}>
          <UserIcon className="h-4 w-4" aria-hidden />
          Your profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut className="h-4 w-4" aria-hidden />
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
